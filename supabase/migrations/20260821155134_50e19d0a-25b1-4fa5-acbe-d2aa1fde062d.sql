-- 1. NULL-direction idempotency: the sentinel lives in the index expression only.
DROP INDEX IF EXISTS public.research_candidates_identity;
CREATE UNIQUE INDEX research_candidates_identity
  ON public.research_candidates (run_id, instrument, coalesce(direction, '∅'), strategy_version)
  WHERE run_id IS NOT NULL;

-- 2. Production view becomes the actual source for regime stats.
CREATE OR REPLACE FUNCTION public.recompute_regime_stats(_model_version smallint DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k constant numeric := 30;
  mv smallint := coalesce(_model_version, 1);
  as_of timestamptz;
  g_n integer; g_fills integer; g_wins integer;
  g_pfill numeric; g_pwin numeric;
  out_rows integer;
  this_run uuid := gen_random_uuid();
  logged integer := 0;
  logged_tier0 integer := 0;
  legacy_null_resolved_at integer := 0;
  def_version smallint;
  defs_created integer := 0;
BEGIN
  IF mv <> 1 THEN
    RETURN jsonb_build_object(
      'skipped', 'model_version_not_promoted',
      'model_version', mv,
      'production_model_version', 1
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('recompute_regime_stats'), mv);
  as_of := clock_timestamp();

  -- Prompt-7 item 4: read the production VIEW, not the table. Research-candidate
  -- rows are unreachable here by construction, not merely filtered out.
  CREATE TEMP TABLE _regime_src ON COMMIT DROP AS
    SELECT instrument,
           direction::text AS direction,
           coalesce(trading_session, 'unknown') AS session,
           volatility_index::numeric AS volatility_index,
           CASE WHEN resolved_outcome = 'never_filled' THEN 0 ELSE 1 END AS filled,
           coalesce(ml_target_label, 0) AS win,
           (resolved_at IS NULL) AS legacy_resolved_at_null
      FROM shadow_executions_production
     WHERE status = 'resolved'
       AND model_version = mv
       AND replay_version = 1
       AND execution_policy = 'legacy_best_target_touched'
       AND detected_at <= as_of
       AND coalesce(resolved_at, last_polled_at, detected_at) <= as_of;

  SELECT count(*) FILTER (WHERE legacy_resolved_at_null)
    INTO legacy_null_resolved_at FROM _regime_src;

  CREATE TEMP TABLE _base ON COMMIT DROP AS
    SELECT instrument, direction, session, volatility_index, filled, win FROM _regime_src;

  INSERT INTO public.vol_definitions (model_version, instrument, definition_version, t1, t2, source)
  SELECT mv, b.instrument, 1,
         percentile_cont(0.3333) WITHIN GROUP (ORDER BY b.volatility_index)::numeric,
         percentile_cont(0.6667) WITHIN GROUP (ORDER BY b.volatility_index)::numeric,
         'bootstrapped_first_observation'
    FROM _base b
   WHERE b.volatility_index IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.vol_definitions d
                      WHERE d.model_version = mv AND d.instrument = b.instrument AND d.active)
   GROUP BY b.instrument
  HAVING percentile_cont(0.3333) WITHIN GROUP (ORDER BY b.volatility_index) IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS defs_created = ROW_COUNT;

  CREATE TEMP TABLE _terc ON COMMIT DROP AS
    SELECT d.instrument, d.t1, d.t2, d.definition_version
      FROM public.vol_definitions d
     WHERE d.model_version = mv AND d.active;

  SELECT max(definition_version) INTO def_version FROM _terc;

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

  g_pfill := CASE WHEN g_n = 0 THEN NULL ELSE g_fills::numeric / g_n END;
  g_pwin  := CASE WHEN g_fills = 0 THEN NULL ELSE g_wins::numeric / g_fills END;

  DELETE FROM regime_stats WHERE model_version = mv AND tier >= 0;

  INSERT INTO regime_stats (model_version, tier, regime_key, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at, vol_definition_version)
  VALUES (mv, 1, 'global', g_n, g_fills, g_wins,
      round(g_pfill, 6), round(g_pwin, 6),
      round(g_pfill, 6), round(g_pwin, 6), as_of, def_version);

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, n_total, n_filled, wins,
      p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2, computed_at, vol_definition_version)
  SELECT mv, 0, t.instrument, t.instrument, 0, 0, 0,
         round(g_pfill, 6), round(g_pwin, 6),
         round(t.t1, 6), round(t.t2, 6), as_of, t.definition_version
    FROM _terc t;

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at,
      vol_definition_version)
  SELECT mv, 2, a.instrument || '|' || a.direction, a.instrument, a.direction, NULL, NULL,
         a.n, a.f, a.w,
         CASE WHEN a.n = 0 THEN NULL ELSE round(a.f::numeric / a.n, 6) END,
         CASE WHEN a.f = 0 THEN NULL ELSE round(a.w::numeric / a.f, 6) END,
         CASE WHEN g_pfill IS NULL THEN NULL ELSE round((a.f + k * g_pfill) / (a.n + k), 6) END,
         CASE WHEN g_pwin  IS NULL THEN NULL ELSE round((a.w + k * g_pwin)  / (a.f + k), 6) END,
         as_of, def_version
    FROM (SELECT instrument, direction, count(*) AS n, sum(filled) AS f, sum(win) AS w
            FROM _tag GROUP BY 1, 2) a;

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at,
      vol_definition_version)
  SELECT mv, 3,
         a.instrument || '|' || a.direction || '|' || a.session || '|' || a.vol_bucket,
         a.instrument, a.direction, a.session, a.vol_bucket,
         a.n, a.f, a.w,
         CASE WHEN a.n = 0 THEN NULL ELSE round(a.f::numeric / a.n, 6) END,
         CASE WHEN a.f = 0 THEN NULL ELSE round(a.w::numeric / a.f, 6) END,
         CASE WHEN p.p_fill_shrunk IS NULL THEN NULL
              ELSE round((a.f + k * p.p_fill_shrunk) / (a.n + k), 6) END,
         CASE WHEN p.p_win_shrunk IS NULL THEN NULL
              ELSE round((a.w + k * p.p_win_shrunk) / (a.f + k), 6) END,
         as_of, def_version
    FROM (SELECT instrument, direction, session, vol_bucket,
                 count(*) AS n, sum(filled) AS f, sum(win) AS w
            FROM _tag GROUP BY 1, 2, 3, 4) a
    JOIN regime_stats p
      ON p.model_version = mv
     AND p.tier = 2
     AND p.regime_key = a.instrument || '|' || a.direction;

  SELECT count(*) INTO out_rows FROM regime_stats WHERE model_version = mv;

  INSERT INTO regime_snapshots (model_version, run_id, computed_at, tier, regime_key, instrument,
      direction, session, vol_bucket, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2, vol_definition_version)
  SELECT mv, this_run, as_of, s.tier, s.regime_key, s.instrument,
         s.direction, s.session, s.vol_bucket, s.n_total, s.n_filled, s.wins,
         s.p_fill_raw, s.p_win_raw, s.p_fill_shrunk, s.p_win_shrunk, s.vol_t1, s.vol_t2,
         s.vol_definition_version
    FROM regime_stats s
   WHERE s.model_version = mv AND s.tier >= 0;
  GET DIAGNOSTICS logged = ROW_COUNT;

  SELECT count(*) INTO logged_tier0
    FROM regime_snapshots
   WHERE run_id = this_run AND tier = 0;

  DELETE FROM regime_snapshots WHERE computed_at < as_of - interval '180 days';

  RETURN jsonb_build_object(
    'model_version', mv,
    'replay_version', 1,
    'execution_policy', 'legacy_best_target_touched',
    'cohort', 'production',
    'source', 'shadow_executions_production',
    'computed_as_of', as_of,
    'rows', out_rows,
    'resolved_samples', g_n,
    'filled_samples', g_fills,
    'wins', g_wins,
    'global_p_fill', round(g_pfill, 4),
    'global_p_win', round(g_pwin, 4),
    'legacy_resolved_at_null', legacy_null_resolved_at,
    'vol_definition_version', def_version,
    'vol_definitions_created', defs_created,
    'run_id', this_run,
    'snapshot_rows', logged,
    'snapshot_tier0_rows', logged_tier0
  );
END;
$function$;

-- 3. Filter-lift research plumbing (research cohort only, admin/service visible).
CREATE TABLE IF NOT EXISTS public.filter_lift_stats (
  manifest_hash text NOT NULL,
  strategy_version smallint NOT NULL,
  gate text NOT NULL,
  arm text NOT NULL,
  run_id uuid NOT NULL,
  n_candidates integer NOT NULL,
  n_mature integer NOT NULL,
  n_resolved integer NOT NULL,
  n_used integer NOT NULL,
  replay_coverage numeric,
  coverage_threshold numeric NOT NULL DEFAULT 0.95,
  mean_r numeric,
  sd_r numeric,
  se_r numeric,
  cluster_n integer,
  stat_status text NOT NULL,
  reason text,
  terminal_replay_horizon_hours integer NOT NULL,
  computed_as_of timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (manifest_hash, gate, arm)
);

GRANT ALL ON public.filter_lift_stats TO service_role;
ALTER TABLE public.filter_lift_stats ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: research output is service-role / SECURITY DEFINER only.

CREATE OR REPLACE FUNCTION public.recompute_filter_lift(_horizon_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hz integer := coalesce(_horizon_hours, 24);
  as_of timestamptz;
  this_run uuid := gen_random_uuid();
  out_rows integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('recompute_filter_lift'));
  as_of := clock_timestamp();

  -- Research cohort ONLY. A production row can never enter this computation.
  CREATE TEMP TABLE _fl_src ON COMMIT DROP AS
    SELECT c.manifest_hash,
           c.strategy_version,
           c.instrument,
           g->>'gate' AS gate,
           g->>'outcome' AS outcome,
           se.id AS execution_id,
           (se.detected_at + make_interval(hours => hz) <= as_of) AS mature,
           (se.status = 'resolved') AS resolved,
           se.data_quality_outcome,
           se.resolved_outcome,
           se.realized_r::numeric AS r_value,
           (date_trunc('day', se.detected_at)::date::text || '|' || se.instrument) AS cluster_key
      FROM research_candidates c
      JOIN shadow_executions se
        ON se.research_candidate_id = c.id
       AND se.cohort = 'research_candidate'
       AND se.replay_version = 1
      CROSS JOIN LATERAL jsonb_array_elements(c.gates) g
     WHERE c.gates_complete
       AND g->>'outcome' IN ('pass', 'fail');

  CREATE TEMP TABLE _fl_class ON COMMIT DROP AS
    SELECT s.*,
           CASE
             WHEN NOT s.mature OR NOT s.resolved THEN 'unresolved'
             WHEN s.data_quality_outcome = 'invalid_plan' THEN 'invalid'
             WHEN s.data_quality_outcome = 'gap_beyond_stop' THEN 'gap_no_trade'
             WHEN s.resolved_outcome = 'never_filled' THEN 'never_filled'
             WHEN s.r_value IS NULL THEN 'invalid'
             ELSE 'executable'
           END AS klass
      FROM _fl_src s;

  DELETE FROM filter_lift_stats;

  WITH agg AS (
    SELECT manifest_hash, strategy_version, gate, outcome AS arm,
           count(*) AS n_candidates,
           count(*) FILTER (WHERE mature) AS n_mature,
           count(*) FILTER (WHERE klass <> 'unresolved') AS n_resolved,
           count(*) FILTER (WHERE klass IN ('executable', 'never_filled', 'gap_no_trade')) AS n_used,
           -- Approved per-plan payoff convention: never-filled and
           -- gap-beyond-stop count as 0R, they are not dropped.
           avg(CASE WHEN klass = 'executable' THEN r_value
                    WHEN klass IN ('never_filled', 'gap_no_trade') THEN 0::numeric END) AS mean_r,
           stddev_samp(CASE WHEN klass = 'executable' THEN r_value
                            WHEN klass IN ('never_filled', 'gap_no_trade') THEN 0::numeric END) AS sd_r,
           count(DISTINCT cluster_key) FILTER (
             WHERE klass IN ('executable', 'never_filled', 'gap_no_trade')) AS cluster_n
      FROM _fl_class
     GROUP BY 1, 2, 3, 4
  )
  INSERT INTO filter_lift_stats (
    manifest_hash, strategy_version, gate, arm, run_id,
    n_candidates, n_mature, n_resolved, n_used, replay_coverage, n_used_dummy_placeholder,
    mean_r, sd_r, se_r, cluster_n, stat_status, reason,
    terminal_replay_horizon_hours, computed_as_of)
  SELECT a.manifest_hash, a.strategy_version, a.gate, a.arm, this_run,
         a.n_candidates, a.n_mature, a.n_resolved, a.n_used,
         CASE WHEN a.n_mature = 0 THEN NULL
              ELSE round(a.n_resolved::numeric / a.n_mature, 6) END,
         NULL,
         round(a.mean_r, 6), round(a.sd_r, 6),
         CASE WHEN a.cluster_n >= 2 AND a.sd_r IS NOT NULL
              THEN round(a.sd_r / sqrt(a.cluster_n::numeric), 6) END,
         a.cluster_n,
         CASE
           WHEN a.n_used = 0 THEN 'unavailable'
           WHEN a.n_mature = 0 OR a.n_resolved::numeric / a.n_mature < 0.95
             THEN 'insufficient_coverage'
           WHEN a.n_used < 30 THEN 'insufficient_sample'
           WHEN a.cluster_n < 10 THEN 'insufficient_clusters'
           ELSE 'descriptive'
         END,
         CASE
           WHEN a.n_used = 0 THEN 'no mature resolved research-candidate plans for this arm'
           WHEN a.n_mature = 0 OR a.n_resolved::numeric / a.n_mature < 0.95
             THEN 'replay coverage below 0.95: unresolved mature plans could still change the mean'
           WHEN a.n_used < 30 THEN 'fewer than 30 observations in this arm'
           WHEN a.cluster_n < 10
             THEN 'fewer than 10 instrument-days: overlapping plans are not independent'
           ELSE 'descriptive comparison within one manifest hash; no causal claim'
         END,
         hz, as_of
    FROM agg a;

  SELECT count(*) INTO out_rows FROM filter_lift_stats;

  RETURN jsonb_build_object(
    'cohort', 'research_candidate',
    'terminal_replay_horizon_hours', hz,
    'computed_as_of', as_of,
    'run_id', this_run,
    'rows', out_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_filter_lift(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_filter_lift(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_filter_lift(integer) TO service_role;