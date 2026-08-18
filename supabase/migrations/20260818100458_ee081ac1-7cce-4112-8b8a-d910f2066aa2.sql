-- 1. Retention safeguard: snapshot learning features onto shadow_executions so the
-- training set survives tiered pruning of scanned_signals.
ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS trading_session text,
  ADD COLUMN IF NOT EXISTS volatility_index numeric,
  ADD COLUMN IF NOT EXISTS atr numeric;

-- The FK was ON DELETE CASCADE, so retention would wipe the dataset. Sever that:
-- keep the join while the signal lives, keep the row (and its snapshot) after.
ALTER TABLE public.shadow_executions
  DROP CONSTRAINT IF EXISTS shadow_executions_signal_id_fkey;
ALTER TABLE public.shadow_executions
  ALTER COLUMN signal_id DROP NOT NULL;
ALTER TABLE public.shadow_executions
  ADD CONSTRAINT shadow_executions_signal_id_fkey
  FOREIGN KEY (signal_id) REFERENCES public.scanned_signals(id) ON DELETE SET NULL;

-- 2. Advisory Bayesian priors on live signals. Shadow mode: recorded, never acted on.
ALTER TABLE public.scanned_signals
  ADD COLUMN IF NOT EXISTS p_fill_prior numeric,
  ADD COLUMN IF NOT EXISTS p_win_prior numeric,
  ADD COLUMN IF NOT EXISTS ev_prior numeric,
  ADD COLUMN IF NOT EXISTS prior_sample_n integer;

-- 3. Hierarchical regime statistics. Single-writer (cron); readers never blocked.
CREATE TABLE IF NOT EXISTS public.regime_stats (
  tier smallint NOT NULL,
  regime_key text NOT NULL,
  instrument text,
  direction text,
  session text,
  vol_bucket text,
  n_total integer NOT NULL DEFAULT 0,
  n_filled integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  p_fill_raw numeric,
  p_win_raw numeric,
  p_fill_shrunk numeric NOT NULL,
  p_win_shrunk numeric NOT NULL,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (tier, regime_key)
);

GRANT SELECT ON public.regime_stats TO authenticated;
GRANT ALL ON public.regime_stats TO service_role;
ALTER TABLE public.regime_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY regime_stats_readable_by_authenticated
  ON public.regime_stats FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS shadow_executions_learning_idx
  ON public.shadow_executions (status, instrument, detected_at);

-- 4. Recompute: one transaction, full rebuild, ~100 output rows. Hierarchical
-- Beta-Binomial shrinkage with prior strength k = 30; every tier shrinks toward
-- its parent, so a 2-sample bucket returns ~94% parent estimate, never 0.0/1.0.
CREATE OR REPLACE FUNCTION public.recompute_regime_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k constant numeric := 30;
  g_n integer; g_fills integer; g_wins integer;
  g_pfill numeric; g_pwin numeric;
  out_rows integer;
BEGIN
  CREATE TEMP TABLE _base ON COMMIT DROP AS
    SELECT instrument,
           direction::text AS direction,
           coalesce(trading_session, 'unknown') AS session,
           volatility_index,
           CASE WHEN resolved_outcome = 'never_filled' THEN 0 ELSE 1 END AS filled,
           coalesce(ml_target_label, 0) AS win
      FROM shadow_executions
     WHERE status = 'resolved';

  -- Terciles are per instrument: gold and EURUSD do not share a volatility scale.
  CREATE TEMP TABLE _terc ON COMMIT DROP AS
    SELECT instrument,
           percentile_cont(0.3333) WITHIN GROUP (ORDER BY volatility_index) AS t1,
           percentile_cont(0.6667) WITHIN GROUP (ORDER BY volatility_index) AS t2
      FROM _base
     WHERE volatility_index IS NOT NULL
     GROUP BY instrument;

  CREATE TEMP TABLE _tag ON COMMIT DROP AS
    SELECT b.instrument, b.direction, b.session, b.filled, b.win,
           CASE WHEN b.volatility_index IS NULL OR t.t1 IS NULL THEN 'unknown'
                WHEN b.volatility_index <= t.t1 THEN 'low'
                WHEN b.volatility_index <= t.t2 THEN 'mid'
                ELSE 'high' END AS vol_bucket
      FROM _base b
      LEFT JOIN _terc t ON t.instrument = b.instrument;

  SELECT count(*), coalesce(sum(filled), 0), coalesce(sum(win), 0)
    INTO g_n, g_fills, g_wins
    FROM _tag;

  -- With no data at all the only honest prior is a coin flip; callers gate on n.
  g_pfill := CASE WHEN g_n = 0 THEN 0.5 ELSE g_fills::numeric / g_n END;
  g_pwin  := CASE WHEN g_fills = 0 THEN 0.5 ELSE g_wins::numeric / g_fills END;

  DELETE FROM regime_stats;

  INSERT INTO regime_stats (tier, regime_key, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
  VALUES (1, 'global', g_n, g_fills, g_wins,
      CASE WHEN g_n = 0 THEN NULL ELSE round(g_pfill, 6) END,
      CASE WHEN g_fills = 0 THEN NULL ELSE round(g_pwin, 6) END,
      round(g_pfill, 6), round(g_pwin, 6), now());

  INSERT INTO regime_stats (tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
  SELECT 2, a.instrument || '|' || a.direction, a.instrument, a.direction, NULL, NULL,
         a.n, a.f, a.w,
         CASE WHEN a.n = 0 THEN NULL ELSE round(a.f::numeric / a.n, 6) END,
         CASE WHEN a.f = 0 THEN NULL ELSE round(a.w::numeric / a.f, 6) END,
         round((a.f + k * g_pfill) / (a.n + k), 6),
         round((a.w + k * g_pwin) / (a.f + k), 6),
         now()
    FROM (SELECT instrument, direction, count(*) AS n, sum(filled) AS f, sum(win) AS w
            FROM _tag GROUP BY 1, 2) a;

  INSERT INTO regime_stats (tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
  SELECT 3,
         a.instrument || '|' || a.direction || '|' || a.session || '|' || a.vol_bucket,
         a.instrument, a.direction, a.session, a.vol_bucket,
         a.n, a.f, a.w,
         CASE WHEN a.n = 0 THEN NULL ELSE round(a.f::numeric / a.n, 6) END,
         CASE WHEN a.f = 0 THEN NULL ELSE round(a.w::numeric / a.f, 6) END,
         round((a.f + k * p.p_fill_shrunk) / (a.n + k), 6),
         round((a.w + k * p.p_win_shrunk) / (a.f + k), 6),
         now()
    FROM (SELECT instrument, direction, session, vol_bucket,
                 count(*) AS n, sum(filled) AS f, sum(win) AS w
            FROM _tag GROUP BY 1, 2, 3, 4) a
    JOIN regime_stats p
      ON p.tier = 2 AND p.regime_key = a.instrument || '|' || a.direction;

  SELECT count(*) INTO out_rows FROM regime_stats;

  RETURN jsonb_build_object(
    'rows', out_rows,
    'resolved_samples', g_n,
    'filled_samples', g_fills,
    'wins', g_wins,
    'global_p_fill', round(g_pfill, 4),
    'global_p_win', round(g_pwin, 4)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_regime_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_regime_stats() FROM anon;
REVOKE ALL ON FUNCTION public.recompute_regime_stats() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_regime_stats() TO service_role;