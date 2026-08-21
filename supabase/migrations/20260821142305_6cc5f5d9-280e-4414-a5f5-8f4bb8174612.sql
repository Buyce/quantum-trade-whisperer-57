CREATE OR REPLACE FUNCTION public.recompute_payoff_stats(
  _model_version smallint DEFAULT 1,
  _replay_version smallint DEFAULT 1,
  _execution_policy text DEFAULT 'legacy_best_target_touched',
  _horizon_hours integer DEFAULT 24
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mv smallint := coalesce(_model_version, 1);
  rv smallint := coalesce(_replay_version, 1);
  pol text := coalesce(_execution_policy, 'legacy_best_target_touched');
  hz integer := coalesce(_horizon_hours, 24);
  as_of timestamptz;
  this_run uuid := gen_random_uuid();
  out_rows integer := 0;
  basis text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('recompute_payoff_stats'), mv * 100 + rv);
  as_of := clock_timestamp();

  basis := CASE WHEN rv = 1 THEN 'realized_r@planned_risk' ELSE 'gross_r@actual_risk' END;

  CREATE TEMP TABLE _payoff_src ON COMMIT DROP AS
    SELECT se.plan_id,
           se.instrument,
           se.direction::text AS direction,
           (se.status = 'resolved'
             AND coalesce(se.resolved_at, se.last_polled_at, se.detected_at) <= as_of) AS resolved,
           (se.resolved_at IS NULL AND se.status = 'resolved') AS legacy_resolved_at_null,
           se.data_quality_outcome,
           se.resolved_outcome,
           (CASE WHEN rv = 1 THEN se.realized_r ELSE se.gross_r END)::numeric AS r_value
      FROM shadow_executions se
     WHERE se.model_version = mv
       AND se.replay_version = rv
       AND se.execution_policy = pol
       AND se.detected_at <= as_of
       AND se.detected_at + make_interval(hours => hz) <= as_of;

  CREATE TEMP TABLE _payoff_class ON COMMIT DROP AS
    SELECT p.*,
           CASE
             WHEN NOT p.resolved THEN 'unresolved'
             WHEN p.data_quality_outcome = 'invalid_plan' THEN 'invalid'
             WHEN p.data_quality_outcome = 'gap_beyond_stop' THEN 'gap_no_trade'
             WHEN p.resolved_outcome = 'never_filled' THEN 'never_filled'
             WHEN p.r_value IS NULL THEN 'invalid'
             ELSE 'executable'
           END AS klass
      FROM _payoff_src p;

  DELETE FROM payoff_stats
   WHERE model_version = mv AND replay_version = rv AND execution_policy = pol;

  WITH grouped AS (
    SELECT 1::smallint AS tier, 'global'::text AS regime_key,
           NULL::text AS g_instrument, NULL::text AS g_direction, c.*
      FROM _payoff_class c
    UNION ALL
    SELECT 2::smallint, c.instrument || '|' || c.direction,
           c.instrument, c.direction, c.*
      FROM _payoff_class c
  ),
  per_plan AS (
    SELECT tier, regime_key, g_instrument, g_direction, 'mean_r_per_plan'::text AS estimand,
           count(*) AS n_mature,
           count(*) FILTER (WHERE klass <> 'unresolved') AS n_resolved_total,
           count(*) FILTER (WHERE klass = 'unresolved') AS n_unresolved_mature,
           count(*) FILTER (WHERE klass IN ('executable', 'never_filled', 'gap_no_trade')) AS n_eligible,
           count(*) FILTER (WHERE klass = 'executable') AS n_executable,
           count(*) FILTER (WHERE klass = 'invalid') AS n_invalid,
           count(*) FILTER (WHERE klass = 'gap_no_trade') AS n_gap,
           count(*) FILTER (WHERE klass = 'never_filled') AS n_nf,
           count(*) FILTER (WHERE legacy_resolved_at_null) AS n_legacy,
           avg(CASE WHEN klass = 'executable' THEN r_value
                    WHEN klass IN ('never_filled', 'gap_no_trade') THEN 0::numeric END) AS mean_r,
           stddev_samp(CASE WHEN klass = 'executable' THEN r_value
                            WHEN klass IN ('never_filled', 'gap_no_trade') THEN 0::numeric END) AS sd_r,
           count(*) FILTER (WHERE klass IN ('executable', 'never_filled', 'gap_no_trade')) AS n_used
      FROM grouped GROUP BY 1, 2, 3, 4
  ),
  given_exec AS (
    SELECT tier, regime_key, g_instrument, g_direction, 'mean_r_given_executable'::text AS estimand,
           count(*) AS n_mature,
           count(*) FILTER (WHERE klass <> 'unresolved') AS n_resolved_total,
           count(*) FILTER (WHERE klass = 'unresolved') AS n_unresolved_mature,
           count(*) FILTER (WHERE klass IN ('executable', 'never_filled', 'gap_no_trade')) AS n_eligible,
           count(*) FILTER (WHERE klass = 'executable') AS n_executable,
           count(*) FILTER (WHERE klass = 'invalid') AS n_invalid,
           count(*) FILTER (WHERE klass = 'gap_no_trade') AS n_gap,
           count(*) FILTER (WHERE klass = 'never_filled') AS n_nf,
           count(*) FILTER (WHERE legacy_resolved_at_null) AS n_legacy,
           avg(r_value) FILTER (WHERE klass = 'executable') AS mean_r,
           stddev_samp(r_value) FILTER (WHERE klass = 'executable') AS sd_r,
           count(*) FILTER (WHERE klass = 'executable') AS n_used
      FROM grouped GROUP BY 1, 2, 3, 4
  ),
  unioned AS (SELECT * FROM per_plan UNION ALL SELECT * FROM given_exec),
  computed AS (
    SELECT u.*,
           CASE WHEN u.n_mature = 0 THEN NULL
                ELSE round(u.n_resolved_total::numeric / u.n_mature, 6) END AS coverage,
           CASE WHEN u.n_used >= 2 AND u.sd_r IS NOT NULL
                THEN u.sd_r / sqrt(u.n_used::numeric) END AS se_r
      FROM unioned u
  )
  INSERT INTO payoff_stats (
    model_version, replay_version, execution_policy, estimand, tier, regime_key,
    instrument, direction,
    n_mature, n_resolved_total, n_unresolved_mature, n_per_plan_eligible, n_executable,
    n_invalid_excluded, n_gap_no_trade, n_never_filled, n_legacy_resolved_at_null,
    replay_coverage, n_used, mean_r, sd_r, se_r,
    ci_method, ci_level, ci_df, ci_lo, ci_hi, cluster_n,
    payoff_basis, stat_status, reason, terminal_replay_horizon_hours, computed_as_of, run_id)
  SELECT mv, rv, pol, c.estimand, c.tier, c.regime_key, c.g_instrument, c.g_direction,
         c.n_mature, c.n_resolved_total, c.n_unresolved_mature, c.n_eligible, c.n_executable,
         c.n_invalid, c.n_gap, c.n_nf, c.n_legacy,
         c.coverage, c.n_used, round(c.mean_r, 6), round(c.sd_r, 6), round(c.se_r, 6),
         CASE WHEN c.n_used >= 30 AND c.se_r IS NOT NULL THEN 'normal_approx_descriptive' END,
         CASE WHEN c.n_used >= 30 AND c.se_r IS NOT NULL THEN 0.95 END,
         CASE WHEN c.n_used >= 2 THEN c.n_used - 1 END,
         CASE WHEN c.n_used >= 30 AND c.se_r IS NOT NULL
              THEN round(c.mean_r - 1.96 * c.se_r, 6) END,
         CASE WHEN c.n_used >= 30 AND c.se_r IS NOT NULL
              THEN round(c.mean_r + 1.96 * c.se_r, 6) END,
         NULL::integer,
         basis,
         CASE
           WHEN c.n_used = 0 THEN 'unavailable'
           WHEN c.coverage IS NULL OR c.coverage < 0.95 THEN 'insufficient_coverage'
           WHEN c.n_used < 30 THEN 'insufficient_sample'
           ELSE 'descriptive'
         END,
         CASE
           WHEN c.n_used = 0 THEN 'no mature resolved plans in this cohort'
           WHEN c.coverage IS NULL OR c.coverage < 0.95
             THEN 'replay coverage below 0.95: unresolved mature plans could still change the mean'
           WHEN c.n_used < 30 THEN 'fewer than 30 observations: no interval is reported'
           ELSE 'descriptive interval only; observations are not independent across overlapping plans'
         END,
         hz, as_of, this_run
    FROM computed c;

  SELECT count(*) INTO out_rows
    FROM payoff_stats
   WHERE model_version = mv AND replay_version = rv AND execution_policy = pol;

  INSERT INTO payoff_snapshots (
    run_id, model_version, replay_version, execution_policy, estimand, tier, regime_key,
    instrument, direction,
    n_mature, n_resolved_total, n_unresolved_mature, n_per_plan_eligible, n_executable,
    n_invalid_excluded, n_gap_no_trade, n_never_filled, n_legacy_resolved_at_null,
    replay_coverage, coverage_threshold, n_used, mean_r, sd_r, se_r,
    ci_method, ci_level, ci_df, ci_lo, ci_hi, cluster_n,
    payoff_basis, stat_status, reason, terminal_replay_horizon_hours, computed_as_of)
  SELECT this_run, s.model_version, s.replay_version, s.execution_policy, s.estimand, s.tier,
         s.regime_key, s.instrument, s.direction,
         s.n_mature, s.n_resolved_total, s.n_unresolved_mature, s.n_per_plan_eligible,
         s.n_executable, s.n_invalid_excluded, s.n_gap_no_trade, s.n_never_filled,
         s.n_legacy_resolved_at_null, s.replay_coverage, s.coverage_threshold, s.n_used,
         s.mean_r, s.sd_r, s.se_r, s.ci_method, s.ci_level, s.ci_df, s.ci_lo, s.ci_hi,
         s.cluster_n, s.payoff_basis, s.stat_status, s.reason,
         s.terminal_replay_horizon_hours, s.computed_as_of
    FROM payoff_stats s
   WHERE s.model_version = mv AND s.replay_version = rv AND s.execution_policy = pol;

  DELETE FROM payoff_snapshots WHERE computed_as_of < as_of - interval '180 days';

  RETURN jsonb_build_object(
    'model_version', mv,
    'replay_version', rv,
    'execution_policy', pol,
    'payoff_basis', basis,
    'terminal_replay_horizon_hours', hz,
    'computed_as_of', as_of,
    'run_id', this_run,
    'rows', out_rows
  );
END;
$function$;