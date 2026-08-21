ALTER TABLE public.research_candidates
  ADD COLUMN IF NOT EXISTS cf_tp1 numeric,
  ADD COLUMN IF NOT EXISTS cf_tp2 numeric,
  ADD COLUMN IF NOT EXISTS cf_tp3 numeric,
  ADD COLUMN IF NOT EXISTS cf_tp1_r numeric,
  ADD COLUMN IF NOT EXISTS cf_tp2_r numeric,
  ADD COLUMN IF NOT EXISTS cf_tp3_r numeric,
  ADD COLUMN IF NOT EXISTS cf_max_r numeric,
  ADD COLUMN IF NOT EXISTS cf_grade text,
  ADD COLUMN IF NOT EXISTS cf_plan_version smallint;

ALTER TABLE public.research_candidates
  DROP CONSTRAINT IF EXISTS research_candidates_cf_ladder_chk;
ALTER TABLE public.research_candidates
  ADD CONSTRAINT research_candidates_cf_ladder_chk
  CHECK (
    cf_plan_version IS NULL
    OR (
      cf_tp1 IS NOT NULL AND cf_tp2 IS NOT NULL AND cf_tp3 IS NOT NULL
      AND cf_tp1_r IS NOT NULL AND cf_tp2_r IS NOT NULL AND cf_tp3_r IS NOT NULL
      AND cf_max_r IS NOT NULL AND cf_grade IS NOT NULL
      AND entry_price IS NOT NULL AND stop_loss IS NOT NULL
      AND risk_price IS NOT NULL AND risk_price > 0
      AND atr IS NOT NULL AND direction IS NOT NULL
    )
  );

ALTER TABLE public.research_candidates
  DROP CONSTRAINT IF EXISTS research_candidates_counterfactual_chk;
ALTER TABLE public.research_candidates
  ADD CONSTRAINT research_candidates_counterfactual_chk
  CHECK (
    plan_origin IS DISTINCT FROM 'counterfactual'
    OR (
      counterfactual_stage IN ('risk_too_wide', 'no_headroom', 'unreachable_r')
      AND research_plan_version IS NOT NULL
      AND cf_plan_version IS NOT NULL
    )
  );

ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS plan_origin text NOT NULL DEFAULT 'production';

UPDATE public.shadow_executions
   SET plan_origin = 'counterfactual'
 WHERE cohort = 'research_candidate' AND plan_origin <> 'counterfactual';

ALTER TABLE public.shadow_executions
  DROP CONSTRAINT IF EXISTS shadow_executions_plan_origin_chk;
ALTER TABLE public.shadow_executions
  ADD CONSTRAINT shadow_executions_plan_origin_chk
  CHECK (plan_origin IN ('production', 'counterfactual'));

ALTER TABLE public.shadow_executions
  DROP CONSTRAINT IF EXISTS shadow_executions_cohort_origin_chk;
ALTER TABLE public.shadow_executions
  ADD CONSTRAINT shadow_executions_cohort_origin_chk
  CHECK (
    (cohort = 'research_candidate' AND plan_origin = 'counterfactual')
    OR (cohort <> 'research_candidate' AND plan_origin = 'production')
  );

CREATE UNIQUE INDEX IF NOT EXISTS shadow_executions_candidate_identity
  ON public.shadow_executions (research_candidate_id, replay_version, execution_policy, plan_origin)
  WHERE research_candidate_id IS NOT NULL;

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

  -- Research cohort ONLY, Replay-V1 ONLY, the exact approved execution policy,
  -- and the common research ladder ONLY. plan_origin is pinned rather than
  -- grouped on: comparing a headroom-conditioned production ladder against an
  -- unconditional research ladder would measure the ladder, not the filter.
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
       AND se.plan_origin = 'counterfactual'
       AND se.replay_version = 1
       AND se.execution_policy = 'legacy_best_target_touched'
      CROSS JOIN LATERAL jsonb_array_elements(c.gates) g
     WHERE c.gates_complete
       AND c.cf_plan_version IS NOT NULL
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
    manifest_hash, strategy_version, gate, arm, plan_origin, run_id,
    n_candidates, n_mature, n_resolved, n_used, replay_coverage,
    mean_r, sd_r, se_r, cluster_n, stat_status, reason,
    terminal_replay_horizon_hours, computed_as_of)
  SELECT a.manifest_hash, a.strategy_version, a.gate, a.arm,
         'common_counterfactual_ladder_v1', this_run,
         a.n_candidates, a.n_mature, a.n_resolved, a.n_used,
         CASE WHEN a.n_mature = 0 THEN NULL
              ELSE round(a.n_resolved::numeric / a.n_mature, 6) END,
         round(a.mean_r, 6), round(a.sd_r, 6),
         -- Overlapping research plans are not independent, so no standard error
         -- is published until the Prompt-8 cluster bootstrap.
         NULL::numeric,
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
           WHEN a.n_used = 0 THEN 'no mature resolved research-ladder plans for this arm'
           WHEN a.n_mature = 0 OR a.n_resolved::numeric / a.n_mature < 0.95
             THEN 'replay coverage below 0.95: unresolved mature plans could still change the mean'
           WHEN a.n_used < 30 THEN 'fewer than 30 observations in this arm'
           WHEN a.cluster_n < 10
             THEN 'fewer than 10 instrument-days: overlapping plans are not independent'
           ELSE 'non-robust descriptive diagnostic under one common research ladder; no interval and no causal claim'
         END,
         hz, as_of
    FROM agg a;

  SELECT count(*) INTO out_rows FROM filter_lift_stats;

  RETURN jsonb_build_object(
    'cohort', 'research_candidate',
    'replay_version', 1,
    'execution_policy', 'legacy_best_target_touched',
    'plan_ladder', 'common_counterfactual_ladder_v1',
    'grouping', 'manifest_hash|gate|arm',
    'inference', 'non_robust_descriptive_diagnostic',
    'terminal_replay_horizon_hours', hz,
    'computed_as_of', as_of,
    'run_id', this_run,
    'rows', out_rows
  );
END;
$function$;