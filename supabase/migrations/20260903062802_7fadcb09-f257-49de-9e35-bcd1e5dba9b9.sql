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
           coalesce(c.direction, 'unknown') AS direction,
           coalesce(c.trading_session, 'unknown') AS session,
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
           END AS klass,
           CASE
             WHEN s.data_quality_outcome = 'invalid_plan' THEN NULL
             WHEN s.data_quality_outcome = 'gap_beyond_stop' THEN 0::numeric
             WHEN s.resolved_outcome = 'never_filled' THEN 0::numeric
             ELSE s.r_value
           END AS r_eff
      FROM _fl_src s;

  -- Global row plus per-slice rows. A slice thinner than the floors below is
  -- reported as its own 'not yet decidable' row, never folded into the global
  -- number and never rounded up.
  CREATE TEMP TABLE _fl_g ON COMMIT DROP AS
    SELECT manifest_hash, strategy_version, 'global' AS slice_dim, ''::text AS slice_key,
           gate, outcome AS arm, mature, klass, r_eff, cluster_key
      FROM _fl_class
    UNION ALL
    SELECT manifest_hash, strategy_version, 'instrument', instrument,
           gate, outcome, mature, klass, r_eff, cluster_key FROM _fl_class
    UNION ALL
    SELECT manifest_hash, strategy_version, 'direction', direction,
           gate, outcome, mature, klass, r_eff, cluster_key FROM _fl_class
    UNION ALL
    SELECT manifest_hash, strategy_version, 'session', session,
           gate, outcome, mature, klass, r_eff, cluster_key FROM _fl_class;

  DELETE FROM filter_lift_stats;

  -- Cluster totals (instrument-day). Overlapping research plans are not
  -- independent, so the interval is cluster-robust: the standard error of the
  -- mean is built from cluster totals, not from individual plans.
  CREATE TEMP TABLE _fl_clus ON COMMIT DROP AS
    SELECT manifest_hash, strategy_version, slice_dim, slice_key, gate, arm, cluster_key,
           count(*) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS n_c,
           sum(r_eff) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS t_c
      FROM _fl_g
     GROUP BY 1,2,3,4,5,6,7;

  WITH agg AS (
    SELECT manifest_hash, strategy_version, slice_dim, slice_key, gate, arm,
           count(*) AS n_candidates,
           count(*) FILTER (WHERE mature) AS n_mature,
           count(*) FILTER (WHERE klass <> 'unresolved') AS n_resolved,
           count(*) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS n_used,
           avg(r_eff) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS mean_r,
           stddev_samp(r_eff) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS sd_r
      FROM _fl_g
     GROUP BY 1,2,3,4,5,6
  ), ca AS (
    SELECT manifest_hash, strategy_version, slice_dim, slice_key, gate, arm,
           count(*) AS cluster_n,
           sum(n_c) AS n_tot,
           sum(t_c) AS t_tot
      FROM _fl_clus
     GROUP BY 1,2,3,4,5,6
  ), se AS (
    SELECT c.manifest_hash, c.strategy_version, c.slice_dim, c.slice_key, c.gate, c.arm,
           CASE
             WHEN count(*) >= 2 AND sum(c.n_c) > 0 THEN
               sqrt(
                 (count(*)::numeric / (count(*) - 1)) *
                 sum(power(c.t_c - (ca.t_tot / ca.n_tot) * c.n_c, 2))
               ) / ca.n_tot
             ELSE NULL::numeric
           END AS se_r
      FROM _fl_clus c
      JOIN ca USING (manifest_hash, strategy_version, slice_dim, slice_key, gate, arm)
     GROUP BY 1,2,3,4,5,6, ca.n_tot, ca.t_tot
  )
  INSERT INTO filter_lift_stats (
    manifest_hash, strategy_version, gate, arm, plan_origin, run_id,
    slice_dim, slice_key,
    n_candidates, n_mature, n_resolved, n_used, replay_coverage,
    mean_r, sd_r, se_r, cluster_n, stat_status, reason,
    terminal_replay_horizon_hours, computed_as_of)
  SELECT a.manifest_hash, a.strategy_version, a.gate, a.arm,
         'common_counterfactual_ladder_v1', this_run,
         a.slice_dim, a.slice_key,
         a.n_candidates, a.n_mature, a.n_resolved, a.n_used,
         CASE WHEN a.n_mature = 0 THEN NULL
              ELSE round(a.n_resolved::numeric / a.n_mature, 6) END,
         round(a.mean_r, 6), round(a.sd_r, 6),
         round(se.se_r, 6),
         ca.cluster_n,
         CASE
           WHEN a.n_used = 0 THEN 'unavailable'
           WHEN a.n_mature = 0 OR a.n_resolved::numeric / a.n_mature < 0.95
             THEN 'insufficient_coverage'
           WHEN a.n_used < 30 THEN 'insufficient_sample'
           WHEN ca.cluster_n < 10 THEN 'insufficient_clusters'
           WHEN se.se_r IS NULL THEN 'insufficient_clusters'
           ELSE 'descriptive'
         END,
         CASE
           WHEN a.n_used = 0 THEN 'no mature resolved research-ladder plans for this arm'
           WHEN a.n_mature = 0 OR a.n_resolved::numeric / a.n_mature < 0.95
             THEN 'replay coverage below 0.95: unresolved mature plans could still change the mean'
           WHEN a.n_used < 30 THEN 'fewer than 30 observations in this arm'
           WHEN ca.cluster_n < 10
             THEN 'fewer than 10 instrument-days: overlapping plans are not independent'
           WHEN se.se_r IS NULL THEN 'fewer than 2 usable clusters: no cluster-robust interval'
           ELSE 'descriptive diagnostic under one common research ladder; cluster-robust interval, no causal claim'
         END,
         hz, as_of
    FROM agg a
    JOIN ca USING (manifest_hash, strategy_version, slice_dim, slice_key, gate, arm)
    LEFT JOIN se USING (manifest_hash, strategy_version, slice_dim, slice_key, gate, arm);

  SELECT count(*) INTO out_rows FROM filter_lift_stats;

  RETURN jsonb_build_object(
    'cohort', 'research_candidate',
    'replay_version', 1,
    'execution_policy', 'legacy_best_target_touched',
    'plan_ladder', 'common_counterfactual_ladder_v1',
    'grouping', 'manifest_hash|slice_dim|slice_key|gate|arm',
    'inference', 'cluster_robust_descriptive',
    'terminal_replay_horizon_hours', hz,
    'computed_as_of', as_of,
    'run_id', this_run,
    'rows', out_rows
  );
END;
$function$;
