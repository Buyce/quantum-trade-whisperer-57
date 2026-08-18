CREATE TABLE public.regime_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
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
  p_win_shrunk numeric NOT NULL
);

GRANT SELECT ON public.regime_snapshots TO authenticated;
GRANT ALL ON public.regime_snapshots TO service_role;

ALTER TABLE public.regime_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "regime_snapshots_readable_by_authenticated"
  ON public.regime_snapshots FOR SELECT TO authenticated USING (true);

CREATE INDEX regime_snapshots_key_time_idx
  ON public.regime_snapshots (tier, regime_key, computed_at DESC);
CREATE INDEX regime_snapshots_run_idx ON public.regime_snapshots (run_id);

CREATE OR REPLACE FUNCTION public.recompute_regime_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k constant numeric := 30;
  g_n integer; g_fills integer; g_wins integer;
  g_pfill numeric; g_pwin numeric;
  out_rows integer;
  this_run uuid := gen_random_uuid();
  logged integer := 0;
BEGIN
  CREATE TEMP TABLE _base ON COMMIT DROP AS
    SELECT instrument,
           direction::text AS direction,
           coalesce(trading_session, 'unknown') AS session,
           volatility_index::numeric AS volatility_index,
           CASE WHEN resolved_outcome = 'never_filled' THEN 0 ELSE 1 END AS filled,
           coalesce(ml_target_label, 0) AS win
      FROM shadow_executions
     WHERE status = 'resolved';

  -- Terciles are per instrument: gold and EURUSD do not share a volatility scale.
  CREATE TEMP TABLE _terc ON COMMIT DROP AS
    SELECT instrument,
           percentile_cont(0.3333) WITHIN GROUP (ORDER BY volatility_index)::numeric AS t1,
           percentile_cont(0.6667) WITHIN GROUP (ORDER BY volatility_index)::numeric AS t2
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

  DELETE FROM regime_stats WHERE tier >= 0;

  INSERT INTO regime_stats (tier, regime_key, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
  VALUES (1, 'global', g_n, g_fills, g_wins,
      CASE WHEN g_n = 0 THEN NULL ELSE round(g_pfill, 6) END,
      CASE WHEN g_fills = 0 THEN NULL ELSE round(g_pwin, 6) END,
      round(g_pfill, 6), round(g_pwin, 6), now());

  -- Tier 0: volatility tercile boundaries, read by the live scanner.
  INSERT INTO regime_stats (tier, regime_key, instrument, n_total, n_filled, wins,
      p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2, computed_at)
  SELECT 0, t.instrument, t.instrument, 0, 0, 0,
         round(g_pfill, 6), round(g_pwin, 6),
         round(t.t1, 6), round(t.t2, 6), now()
    FROM _terc t;

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

  -- Training-data history: append this iteration verbatim so the evolution of
  -- every regime is auditable after regime_stats is overwritten next hour.
  INSERT INTO regime_snapshots (run_id, computed_at, tier, regime_key, instrument,
      direction, session, vol_bucket, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk)
  SELECT this_run, now(), s.tier, s.regime_key, s.instrument,
         s.direction, s.session, s.vol_bucket, s.n_total, s.n_filled, s.wins,
         s.p_fill_raw, s.p_win_raw, s.p_fill_shrunk, s.p_win_shrunk
    FROM regime_stats s
   WHERE s.tier >= 1;
  GET DIAGNOSTICS logged = ROW_COUNT;

  DELETE FROM regime_snapshots WHERE computed_at < now() - interval '180 days';

  RETURN jsonb_build_object(
    'rows', out_rows,
    'resolved_samples', g_n,
    'filled_samples', g_fills,
    'wins', g_wins,
    'global_p_fill', round(g_pfill, 4),
    'global_p_win', round(g_pwin, 4),
    'run_id', this_run,
    'snapshot_rows', logged
  );
END;
$function$;