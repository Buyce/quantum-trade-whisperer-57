
-- 6B: research payoff layer (admin-only). No production surface reads these tables.

-- 1) Replay registry re-seed with the corrected cursor-based detection-bar rule
--    and the full immutable semantics manifest. Guarded: ANY Replay-V2 row means
--    the V2 identity has already produced data and MUST NOT be mutated in place.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shadow_executions WHERE replay_version = 2) THEN
    RAISE EXCEPTION
      '6E.6 guard: Replay-V2 rows exist; V2 manifest is frozen. Register Replay V3 instead.';
  END IF;
END
$guard$;

INSERT INTO public.replay_versions (version, label, code_hash, semantics)
VALUES
  (1, 'legacy_m15_optimistic', 'e3357869b4f6dc04', '{"tif": {"minutes": 30, "rule": "the fill test runs BEFORE the deadline test, so a touch after detected_at + TIF still fills"}, "detectionBar": "cursor-based: enrolment sets replay_cursor = detected_at, and the first candle consumed is the first candle with time > replay_cursor, so the forming detection bar is not replayed", "risk": "R is measured against the PLANNED risk (|entry - stop|), even after a gap fill", "stop": "any stop touch resolves as exactly -1R; a bar opening beyond the stop is still priced at the stop", "ambiguity": "within one bar the stop is assumed to precede any target (no counter recorded)", "target": "the deepest target touched in a bar is credited (best_target_touched)", "verticalBarrier": {"hours": 24, "rule": "mark to the barrier candle''s close"}, "excursions": "MFE/MAE include the whole fill bar and use the planned risk denominator", "executionPolicy": "legacy_best_target_touched", "costs": "no cost model: realized_r is gross by construction and net_r is not computed", "registered_by": "prompt-6e", "frozen": true, "provenance": "characterisation of the frozen production labeller"}'::jsonb),
  (2, 'm15_fail_closed_actual_risk', 'fd3a5fc5a6b386e7', '{"tif": {"minutes": 30, "rule": "a bar may fill only when its whole interval lies inside the live-order window: bar_open + 15m <= detected_at + TIF", "spanningBar": "a bar straddling the deadline sets fill_ambiguous_tif and fails closed (no fill)"}, "detectionBar": "unchanged from V1 \u2014 cursor-based: enrolment sets replay_cursor = detected_at and the first candle consumed is the first candle with time > replay_cursor; the forming detection bar is not replayed", "risk": {"denominator": "risk_price_actual = |fill_price - stop_loss|", "appliesTo": ["gross_r", "mfe_r", "mae_r", "target R recompute", "vertical mark-to-market"]}, "fill": {"limitSemantics": "favorable gap-through fills at the bar open; adverse fills are never invented", "invalidGap": "a bar whose open is at/through the stop while the order still works resolves as gap_beyond_stop (NULL label, NULL gross_r)"}, "stopGap": {"ordinary": "a stop touch on a bar that did not open beyond the stop is exactly -1R", "gapThrough": "a later bar opening beyond the stop exits at that bar''s OPEN, sets stop_gap_through and may be worse than -1R"}, "targetGap": "a bar opening favorably beyond a target credits the target price, never the open", "ambiguity": {"sameBarStopAndTarget": "stop wins, ambiguous_bars += 1, adjudication = m15_conservative_fallback", "chronologyFields": "tp1_before_stop and stop_before_tp1 stay NULL whenever the order is unknowable; they are populated only when the two events fall in different bars"}, "fillBarCausality": {"ordinaryIntrabarFill": "a target touched in the fill bar is NOT credited: the bar is marked conservative, the trade stays open and target adjudication resumes on the next candle", "ordinaryIntrabarFillAnalytics": "first_target_touched / max_target_touched are not set from that bar; a TP1 touch is recorded in ambiguous_bar_target_touch as an unproven post-entry touch (value 1 only)", "gapAtOpenFill": "a gap-at-open fill existed for the whole bar, so same-bar barrier evaluation and target analytics proceed normally", "excursions": "an ordinary intrabar fill bar contributes neither MFE nor MAE (fill_bar_excursion_ambiguous = true); a gap-at-open fill bar does"}, "verticalBarrier": {"hours": 24, "rule": "mark to the barrier candle''s close using risk_price_actual"}, "dataQualityOutcomes": {"invalid_plan": "non-finite/zero risk, inverted stop or targets on the wrong side", "gap_beyond_stop": "entry-side gap that opened at/through the stop", "handling": "NULL ml_target_label and NULL gross_r; excluded from every fill/win denominator"}, "executionPolicy": {"policy": "single_exit_first_target", "realizedExit": "execution ends at the first target (TP1)", "postExitAnalytics": "execution ends at TP1, so max_target_touched is 1 on a win and deeper ladder touches are not recorded at all; no post-exit path analytic is stored"}, "candleSource": "reuses the M15 array already fetched by the hourly production resolver for that instrument; Replay V2 issues no provider request of its own", "scheduling": "production Replay-V1 rows are resolved first (model 1 may consume the whole existing row budget, then model 2, then model 3); Replay-V2 gets a separate bounded slice from the same candles", "costs": "gross_r only; net_r stays NULL until a documented broker cost schedule exists", "fillTime": {"resolution": "m15", "meaning": "fill_bar_time is a bar-open timestamp, never a broker execution time"}, "registered_by": "prompt-6e", "research_only": true}'::jsonb)
ON CONFLICT (version) DO UPDATE
  SET label = EXCLUDED.label,
      code_hash = EXCLUDED.code_hash,
      semantics = EXCLUDED.semantics;

-- 2) Payoff estimand tables. Research-only: service_role writes, admin reads via RPC.
CREATE TABLE IF NOT EXISTS public.payoff_stats (
  model_version smallint NOT NULL,
  replay_version smallint NOT NULL,
  execution_policy text NOT NULL,
  estimand text NOT NULL,
  tier smallint NOT NULL,
  regime_key text NOT NULL,
  instrument text,
  direction text,
  n_mature integer NOT NULL DEFAULT 0,
  n_resolved_total integer NOT NULL DEFAULT 0,
  n_unresolved_mature integer NOT NULL DEFAULT 0,
  n_per_plan_eligible integer NOT NULL DEFAULT 0,
  n_executable integer NOT NULL DEFAULT 0,
  n_invalid_excluded integer NOT NULL DEFAULT 0,
  n_gap_no_trade integer NOT NULL DEFAULT 0,
  n_never_filled integer NOT NULL DEFAULT 0,
  n_legacy_resolved_at_null integer NOT NULL DEFAULT 0,
  replay_coverage numeric,
  coverage_threshold numeric NOT NULL DEFAULT 0.95,
  n_used integer NOT NULL DEFAULT 0,
  mean_r numeric,
  sd_r numeric,
  se_r numeric,
  ci_method text,
  ci_level numeric,
  ci_df integer,
  ci_lo numeric,
  ci_hi numeric,
  cluster_n integer,
  payoff_basis text NOT NULL,
  stat_status text NOT NULL,
  reason text,
  terminal_replay_horizon_hours integer NOT NULL,
  computed_as_of timestamptz NOT NULL DEFAULT now(),
  run_id uuid NOT NULL,
  PRIMARY KEY (model_version, replay_version, execution_policy, estimand, tier, regime_key)
);
GRANT ALL ON public.payoff_stats TO service_role;
ALTER TABLE public.payoff_stats ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.payoff_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  model_version smallint NOT NULL,
  replay_version smallint NOT NULL,
  execution_policy text NOT NULL,
  estimand text NOT NULL,
  tier smallint NOT NULL,
  regime_key text NOT NULL,
  instrument text,
  direction text,
  n_mature integer NOT NULL DEFAULT 0,
  n_resolved_total integer NOT NULL DEFAULT 0,
  n_unresolved_mature integer NOT NULL DEFAULT 0,
  n_per_plan_eligible integer NOT NULL DEFAULT 0,
  n_executable integer NOT NULL DEFAULT 0,
  n_invalid_excluded integer NOT NULL DEFAULT 0,
  n_gap_no_trade integer NOT NULL DEFAULT 0,
  n_never_filled integer NOT NULL DEFAULT 0,
  n_legacy_resolved_at_null integer NOT NULL DEFAULT 0,
  replay_coverage numeric,
  coverage_threshold numeric NOT NULL DEFAULT 0.95,
  n_used integer NOT NULL DEFAULT 0,
  mean_r numeric,
  sd_r numeric,
  se_r numeric,
  ci_method text,
  ci_level numeric,
  ci_df integer,
  ci_lo numeric,
  ci_hi numeric,
  cluster_n integer,
  payoff_basis text NOT NULL,
  stat_status text NOT NULL,
  reason text,
  terminal_replay_horizon_hours integer NOT NULL,
  computed_as_of timestamptz NOT NULL,
  UNIQUE (run_id, model_version, replay_version, execution_policy, estimand, tier, regime_key)
);
CREATE INDEX IF NOT EXISTS payoff_snapshots_as_of_idx ON public.payoff_snapshots (computed_as_of DESC);
GRANT ALL ON public.payoff_snapshots TO service_role;
ALTER TABLE public.payoff_snapshots ENABLE ROW LEVEL SECURITY;

-- 3) Payoff recompute. Point-in-time, advisory-locked, single as_of + run_id.
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

  -- Mature cohort: a plan is mature only once its terminal replay horizon has
  -- fully elapsed as of this run. The vertical barrier already contains the TIF.
  CREATE TEMP TABLE _payoff_src ON COMMIT DROP AS
    SELECT se.plan_id,
           se.instrument,
           se.direction::text AS direction,
           (se.status = 'resolved'
             AND coalesce(se.resolved_at, se.last_polled_at, se.detected_at) <= as_of) AS resolved,
           (se.resolved_at IS NULL AND se.status = 'resolved') AS legacy_resolved_at_null,
           se.data_quality_outcome,
           se.resolved_outcome,
           CASE WHEN rv = 1 THEN se.realized_r ELSE se.gross_r END AS r_value
      FROM shadow_executions se
     WHERE se.model_version = mv
       AND se.replay_version = rv
       AND se.execution_policy = pol
       AND se.detected_at <= as_of
       AND se.detected_at + make_interval(hours => hz) <= as_of;

  -- Per-plan classification. gap_beyond_stop is a resolved replay that never
  -- traded, so it contributes 0R to the per-plan estimand. invalid_plan is a
  -- broken observation and is excluded from every denominator.
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
                    WHEN klass IN ('never_filled', 'gap_no_trade') THEN 0 END) AS mean_r,
           stddev_samp(CASE WHEN klass = 'executable' THEN r_value
                            WHEN klass IN ('never_filled', 'gap_no_trade') THEN 0 END) AS sd_r,
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
                THEN u.sd_r / sqrt(u.n_used) END AS se_r
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

REVOKE ALL ON FUNCTION public.recompute_payoff_stats(smallint, smallint, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_payoff_stats(smallint, smallint, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.recompute_payoff_stats(smallint, smallint, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_payoff_stats(smallint, smallint, text, integer) TO service_role;

-- 4) Admin-only research read. No direct SELECT on the payoff tables is granted.
CREATE OR REPLACE FUNCTION public.get_admin_payoff_research()
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
    'cohorts', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.model_version, s.replay_version,
                                          s.estimand, s.tier, s.regime_key)
                           FROM payoff_stats s), '[]'::jsonb),
    'registry', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.version)
                            FROM replay_versions r), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_payoff_research() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_payoff_research() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_payoff_research() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_payoff_research() TO service_role;
