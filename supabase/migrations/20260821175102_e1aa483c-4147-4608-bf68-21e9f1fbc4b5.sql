-- Prompt 7G: research-plan provenance on candidates and origin-split filter lift.

ALTER TABLE public.research_candidates
  ADD COLUMN IF NOT EXISTS plan_origin text,
  ADD COLUMN IF NOT EXISTS counterfactual_stage text,
  ADD COLUMN IF NOT EXISTS research_plan_version smallint,
  ADD COLUMN IF NOT EXISTS counterfactual_class text;

ALTER TABLE public.research_candidates
  DROP CONSTRAINT IF EXISTS research_candidates_plan_origin_chk;
ALTER TABLE public.research_candidates
  ADD CONSTRAINT research_candidates_plan_origin_chk
  CHECK (plan_origin IS NULL OR plan_origin IN ('production', 'counterfactual'));

-- A counterfactual plan may only exist for a filter rejection that carried
-- genuinely derived geometry, and must be version-pinned.
ALTER TABLE public.research_candidates
  DROP CONSTRAINT IF EXISTS research_candidates_counterfactual_chk;
ALTER TABLE public.research_candidates
  ADD CONSTRAINT research_candidates_counterfactual_chk
  CHECK (
    plan_origin IS DISTINCT FROM 'counterfactual'
    OR (
      counterfactual_stage IN ('risk_too_wide', 'no_headroom', 'unreachable_r')
      AND research_plan_version IS NOT NULL
      AND entry_price IS NOT NULL
      AND stop_loss IS NOT NULL
      AND risk_price IS NOT NULL
      AND risk_price > 0
      AND atr IS NOT NULL
      AND direction IS NOT NULL
    )
  );

-- Backfill: every candidate captured so far is either a published production
-- plan or had no plan at all.
UPDATE public.research_candidates
   SET plan_origin = 'production'
 WHERE plan_origin IS NULL AND terminal_stage = 'published';

ALTER TABLE public.filter_lift_stats
  ADD COLUMN IF NOT EXISTS plan_origin text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.filter_lift_stats
  DROP CONSTRAINT IF EXISTS filter_lift_stats_pkey;
ALTER TABLE public.filter_lift_stats
  ADD PRIMARY KEY (manifest_hash, gate, arm, plan_origin);

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

  -- Research cohort ONLY, Replay-V1 ONLY, and the exact approved execution
  -- policy: replay identity is the (replay_version, execution_policy) tuple, so
  -- a future policy can never be silently pooled into these numbers.
  CREATE TEMP TABLE _fl_src ON COMMIT DROP AS
    SELECT c.manifest_hash,
           c.strategy_version,
           c.instrument,
           coalesce(c.plan_origin, 'unknown') AS plan_origin,
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
       AND se.execution_policy = 'legacy_best_target_touched'
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
    SELECT manifest_hash, strategy_version, gate, outcome AS arm, plan_origin,
           count(*) AS n_candidates,
           count(*) FILTER (WHERE mature) AS n_mature,
           count(*) FILTER (WHERE klass <> 'unresolved') AS n_resolved,
           count(*) FILTER (WHERE klass IN ('executable', 'never_filled', 'gap_no_trade')) AS n_used,
           avg(CASE WHEN klass = 'executable' THEN r_value
                    WHEN klass IN ('never_filled', 'gap_no_trade') THEN 0::numeric END) AS mean_r,
           stddev_samp(CASE WHEN klass = 'executable' THEN r_value
                            WHEN klass IN ('never_filled', 'gap_no_trade') THEN 0::numeric END) AS sd_r,
           count(DISTINCT cluster_key) FILTER (
             WHERE klass IN ('executable', 'never_filled', 'gap_no_trade')) AS cluster_n
      FROM _fl_class
     GROUP BY 1, 2, 3, 4, 5
  )
  INSERT INTO filter_lift_stats (
    manifest_hash, strategy_version, gate, arm, plan_origin, run_id,
    n_candidates, n_mature, n_resolved, n_used, replay_coverage,
    mean_r, sd_r, se_r, cluster_n, stat_status, reason,
    terminal_replay_horizon_hours, computed_as_of)
  SELECT a.manifest_hash, a.strategy_version, a.gate, a.arm, a.plan_origin, this_run,
         a.n_candidates, a.n_mature, a.n_resolved, a.n_used,
         CASE WHEN a.n_mature = 0 THEN NULL
              ELSE round(a.n_resolved::numeric / a.n_mature, 6) END,
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
           ELSE 'descriptive comparison within one manifest hash and one plan origin; no causal claim'
         END,
         hz, as_of
    FROM agg a;

  SELECT count(*) INTO out_rows FROM filter_lift_stats;

  RETURN jsonb_build_object(
    'cohort', 'research_candidate',
    'replay_version', 1,
    'execution_policy', 'legacy_best_target_touched',
    'grouping', 'manifest_hash|gate|arm|plan_origin',
    'terminal_replay_horizon_hours', hz,
    'computed_as_of', as_of,
    'run_id', this_run,
    'rows', out_rows
  );
END;
$function$;

-- Funnel: expose the origin split so the panel can show whether the rejected
-- cohort is actually being captured.
CREATE OR REPLACE FUNCTION public.get_admin_candidate_funnel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '3000ms'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'flags', (SELECT to_jsonb(f) FROM (
        SELECT candidate_capture_enabled, candidate_enrolment_enabled, candidate_rows_per_run,
               research_errors, research_last_error, research_last_error_at
          FROM shadow_engine_state LIMIT 1) f),
    'totals', (SELECT to_jsonb(t) FROM (
        SELECT count(*) AS n,
               count(*) FILTER (WHERE detected_at > now() - interval '24 hours') AS n_24h,
               count(*) FILTER (WHERE terminal_stage = 'published') AS published,
               count(*) FILTER (WHERE entry_price IS NOT NULL) AS with_geometry,
               count(*) FILTER (WHERE NOT gates_complete) AS gates_incomplete,
               count(*) FILTER (WHERE enrolled_plan_id IS NOT NULL) AS enrolled,
               count(*) FILTER (WHERE enrolled_plan_id IS NULL AND entry_price IS NOT NULL)
                 AS enrolment_backlog,
               min(detected_at) AS first_seen,
               max(detected_at) AS last_seen
          FROM research_candidates) t),
    'by_stage', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.n DESC) FROM (
        SELECT terminal_stage, count(*) AS n,
               count(*) FILTER (WHERE entry_price IS NOT NULL) AS with_geometry
          FROM research_candidates GROUP BY terminal_stage) s), '[]'::jsonb),
    'by_instrument', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.instrument) FROM (
        SELECT instrument, direction, count(*) AS n
          FROM research_candidates GROUP BY instrument, direction) i), '[]'::jsonb),
    'gate_outcomes', coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.gate) FROM (
        SELECT e->>'gate' AS gate,
               count(*) FILTER (WHERE e->>'outcome' = 'pass') AS pass,
               count(*) FILTER (WHERE e->>'outcome' = 'fail') AS fail,
               count(*) FILTER (WHERE e->>'outcome' = 'not_evaluable') AS not_evaluable
          FROM research_candidates c, jsonb_array_elements(c.gates) e
         GROUP BY e->>'gate') g), '[]'::jsonb),
    'by_plan_origin', coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.plan_origin) FROM (
        SELECT coalesce(plan_origin, 'none') AS plan_origin,
               count(*) AS n,
               count(*) FILTER (WHERE enrolled_plan_id IS NOT NULL) AS enrolled
          FROM research_candidates GROUP BY 1) o), '[]'::jsonb),
    'cohort_counts', coalesce((SELECT jsonb_object_agg(cohort, n) FROM (
        SELECT cohort, count(*) AS n FROM shadow_executions GROUP BY cohort) x), '{}'::jsonb)
  ) INTO v;

  RETURN v;
END;
$function$;