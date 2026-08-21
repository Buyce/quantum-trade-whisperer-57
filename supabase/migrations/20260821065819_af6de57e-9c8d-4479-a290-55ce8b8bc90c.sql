-- 1. Model version registry -------------------------------------------------
CREATE TABLE public.model_versions (
  version smallint PRIMARY KEY,
  label text NOT NULL,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  code_hash text,
  notes text,
  activated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);

GRANT SELECT ON public.model_versions TO authenticated;
GRANT ALL ON public.model_versions TO service_role;
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_versions_readable_by_authenticated
  ON public.model_versions FOR SELECT TO authenticated USING (true);

INSERT INTO public.model_versions (version, label, components, notes)
VALUES (
  1,
  'V1 production engine',
  jsonb_build_object(
    'pattern', 'abc-m15-v1',
    'grading', 'institutional-confluence-v1',
    'profile', 'session-aware-dynamic-entry-v1',
    'replay', 'triple-barrier-v1',
    'learning', 'hierarchical-beta-binomial-k30-v1',
    'execution', 'limit-tif30-v1'
  ),
  'Baseline: the engine as it ran when the quantitative integrity baseline was captured. No logic change accompanied this migration.'
);

-- 2. Version stamps on observation tables ------------------------------------
ALTER TABLE public.scanned_signals  ADD COLUMN model_version smallint NOT NULL DEFAULT 1;
ALTER TABLE public.shadow_executions ADD COLUMN model_version smallint NOT NULL DEFAULT 1;
ALTER TABLE public.regime_snapshots  ADD COLUMN model_version smallint NOT NULL DEFAULT 1;
ALTER TABLE public.regime_stats      ADD COLUMN model_version smallint NOT NULL DEFAULT 1;

-- regime_stats is fully replaced on every recompute, so the version MUST be
-- part of its identity or a research cohort would collide with, and then be
-- deleted by, the production rebuild.
ALTER TABLE public.regime_stats DROP CONSTRAINT regime_stats_pkey;
ALTER TABLE public.regime_stats
  ADD CONSTRAINT regime_stats_pkey PRIMARY KEY (model_version, tier, regime_key);

-- 3. Pairing key: one V1 signal and its future V2 twin share this observation.
ALTER TABLE public.scanned_signals   ADD COLUMN observation_key text;
ALTER TABLE public.shadow_executions ADD COLUMN observation_key text;
CREATE INDEX scanned_signals_observation_idx
  ON public.scanned_signals (observation_key) WHERE observation_key IS NOT NULL;
CREATE INDEX shadow_executions_observation_idx
  ON public.shadow_executions (observation_key, model_version) WHERE observation_key IS NOT NULL;

-- 4. Immutable baseline documents --------------------------------------------
CREATE TABLE public.baseline_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'quantitative_integrity',
  model_version smallint NOT NULL DEFAULT 1,
  pinned_run_id uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  metrics jsonb NOT NULL,
  UNIQUE (pinned_run_id, kind)
);

GRANT SELECT ON public.baseline_snapshots TO authenticated;
GRANT ALL ON public.baseline_snapshots TO service_role;
ALTER TABLE public.baseline_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_snapshots_readable_by_authenticated
  ON public.baseline_snapshots FOR SELECT TO authenticated USING (true);

-- 5. Version-aware statistics rebuild ----------------------------------------
DROP FUNCTION IF EXISTS public.recompute_regime_stats();

CREATE OR REPLACE FUNCTION public.recompute_regime_stats(_model_version smallint DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k constant numeric := 30;
  mv smallint := coalesce(_model_version, 1);
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
     WHERE status = 'resolved'
       AND model_version = mv;

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

  DELETE FROM regime_stats WHERE model_version = mv AND tier >= 0;

  INSERT INTO regime_stats (model_version, tier, regime_key, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
  VALUES (mv, 1, 'global', g_n, g_fills, g_wins,
      CASE WHEN g_n = 0 THEN NULL ELSE round(g_pfill, 6) END,
      CASE WHEN g_fills = 0 THEN NULL ELSE round(g_pwin, 6) END,
      round(g_pfill, 6), round(g_pwin, 6), now());

  -- Tier 0: volatility tercile boundaries, read by the live scanner.
  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, n_total, n_filled, wins,
      p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2, computed_at)
  SELECT mv, 0, t.instrument, t.instrument, 0, 0, 0,
         round(g_pfill, 6), round(g_pwin, 6),
         round(t.t1, 6), round(t.t2, 6), now()
    FROM _terc t;

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
  SELECT mv, 2, a.instrument || '|' || a.direction, a.instrument, a.direction, NULL, NULL,
         a.n, a.f, a.w,
         CASE WHEN a.n = 0 THEN NULL ELSE round(a.f::numeric / a.n, 6) END,
         CASE WHEN a.f = 0 THEN NULL ELSE round(a.w::numeric / a.f, 6) END,
         round((a.f + k * g_pfill) / (a.n + k), 6),
         round((a.w + k * g_pwin) / (a.f + k), 6),
         now()
    FROM (SELECT instrument, direction, count(*) AS n, sum(filled) AS f, sum(win) AS w
            FROM _tag GROUP BY 1, 2) a;

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
  SELECT mv, 3,
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
      ON p.model_version = mv
     AND p.tier = 2
     AND p.regime_key = a.instrument || '|' || a.direction;

  SELECT count(*) INTO out_rows FROM regime_stats WHERE model_version = mv;

  -- Training-data history: append this iteration verbatim so the evolution of
  -- every regime is auditable after regime_stats is overwritten next hour.
  INSERT INTO regime_snapshots (model_version, run_id, computed_at, tier, regime_key, instrument,
      direction, session, vol_bucket, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk)
  SELECT mv, this_run, now(), s.tier, s.regime_key, s.instrument,
         s.direction, s.session, s.vol_bucket, s.n_total, s.n_filled, s.wins,
         s.p_fill_raw, s.p_win_raw, s.p_fill_shrunk, s.p_win_shrunk
    FROM regime_stats s
   WHERE s.model_version = mv AND s.tier >= 1;
  GET DIAGNOSTICS logged = ROW_COUNT;

  DELETE FROM regime_snapshots WHERE computed_at < now() - interval '180 days';

  RETURN jsonb_build_object(
    'model_version', mv,
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

-- 6. Claim RPC now returns the scan run id so the observation can be recorded.
DROP FUNCTION IF EXISTS public.claim_scan_job();

CREATE OR REPLACE FUNCTION public.claim_scan_job()
 RETURNS TABLE(id bigint, instrument text, enqueued_at timestamp with time zone, run_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  update public.scan_queue q
     set status = 'processing',
         attempts = q.attempts + 1,
         started_at = now()
   where q.id = (
     select q2.id
       from public.scan_queue q2
      where q2.status = 'pending'
      order by q2.enqueued_at
      for update skip locked
      limit 1
   )
  returning q.id, q.instrument, q.enqueued_at, q.run_id;
end;
$function$;