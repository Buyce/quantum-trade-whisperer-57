-- Prompt 8/9 Stage 2 — additive journal + experiment schema. No backfill.

ALTER TABLE public.executed_trades
  -- Immutable creation-time plan/context snapshot (canonical journal context)
  ADD COLUMN IF NOT EXISTS planned_entry numeric,
  ADD COLUMN IF NOT EXISTS planned_stop numeric,
  ADD COLUMN IF NOT EXISTS planned_direction text,
  ADD COLUMN IF NOT EXISTS signal_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS signal_instrument text,
  ADD COLUMN IF NOT EXISTS signal_grade text,
  ADD COLUMN IF NOT EXISTS signal_trading_session text,
  ADD COLUMN IF NOT EXISTS signal_time_of_day smallint,
  ADD COLUMN IF NOT EXISTS signal_day_of_week smallint,
  -- Execution reality
  ADD COLUMN IF NOT EXISTS actual_initial_stop numeric,
  ADD COLUMN IF NOT EXISTS stop_provenance text,
  ADD COLUMN IF NOT EXISTS actual_entry_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_exit_at timestamptz,
  ADD COLUMN IF NOT EXISTS broker_ticket text,
  ADD COLUMN IF NOT EXISTS partial_exits jsonb,
  -- Monetary costs: money, never price distance
  ADD COLUMN IF NOT EXISTS commission numeric,
  ADD COLUMN IF NOT EXISTS swap numeric,
  ADD COLUMN IF NOT EXISTS cost_currency text,
  ADD COLUMN IF NOT EXISTS cost_unit text,
  -- Canonical dual-basis R. No row-level r_basis by design.
  ADD COLUMN IF NOT EXISTS r_vs_plan numeric,
  ADD COLUMN IF NOT EXISTS r_vs_actual_risk numeric,
  ADD COLUMN IF NOT EXISTS r_availability text,
  ADD COLUMN IF NOT EXISTS r_math_version smallint,
  ADD COLUMN IF NOT EXISTS net_r numeric,
  ADD COLUMN IF NOT EXISTS verification_level text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS trade_state text NOT NULL DEFAULT 'logged';

COMMENT ON COLUMN public.executed_trades.realized_r_multiple IS
  'LEGACY / FROZEN provenance. Pre-r_math_version-1 rows only, mixed basis. Never written or backfilled again.';
COMMENT ON COLUMN public.executed_trades.derived_r IS
  'LEGACY / FROZEN provenance. Pre-r_math_version-1 rows only. Never written or backfilled again.';
COMMENT ON COLUMN public.executed_trades.r_vs_plan IS
  'gross_move / abs(planned_entry - planned_stop); gross_move anchors on the actual fill.';
COMMENT ON COLUMN public.executed_trades.r_vs_actual_risk IS
  'gross_move / abs(actual_entry_price - coalesce(actual_initial_stop, planned_stop)).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executed_trades_planned_direction_chk') THEN
    ALTER TABLE public.executed_trades ADD CONSTRAINT executed_trades_planned_direction_chk
      CHECK (planned_direction IS NULL OR planned_direction IN ('long','short'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executed_trades_stop_provenance_chk') THEN
    ALTER TABLE public.executed_trades ADD CONSTRAINT executed_trades_stop_provenance_chk
      CHECK (stop_provenance IS NULL OR stop_provenance IN ('actual_stop','planned_stop_fallback','unavailable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executed_trades_r_availability_chk') THEN
    ALTER TABLE public.executed_trades ADD CONSTRAINT executed_trades_r_availability_chk
      CHECK (r_availability IS NULL OR r_availability IN ('both','plan_only','actual_risk_only','unavailable_open','unavailable_no_prices','unavailable_no_plan','unavailable_zero_risk'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executed_trades_cost_unit_chk') THEN
    ALTER TABLE public.executed_trades ADD CONSTRAINT executed_trades_cost_unit_chk
      CHECK (cost_unit IS NULL OR cost_unit IN ('account_currency','instrument_quote','points','unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executed_trades_verification_level_chk') THEN
    ALTER TABLE public.executed_trades ADD CONSTRAINT executed_trades_verification_level_chk
      CHECK (verification_level IN ('unverified','self_reported','plan_verified'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executed_trades_trade_state_chk') THEN
    ALTER TABLE public.executed_trades ADD CONSTRAINT executed_trades_trade_state_chk
      CHECK (trade_state IN ('logged','open','resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executed_trades_prices_paired_chk') THEN
    ALTER TABLE public.executed_trades ADD CONSTRAINT executed_trades_prices_paired_chk
      CHECK ((actual_entry_price IS NULL) = (actual_exit_price IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executed_trades_exec_times_chk') THEN
    ALTER TABLE public.executed_trades ADD CONSTRAINT executed_trades_exec_times_chk
      CHECK (actual_entry_at IS NULL OR actual_exit_at IS NULL OR actual_exit_at >= actual_entry_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS executed_trades_signal_detected_at_idx
  ON public.executed_trades (user_id, signal_detected_at);

-- Experiment ledger: predeclared, bounded hypothesis families.
CREATE TABLE IF NOT EXISTS public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_key text NOT NULL UNIQUE,
  hypothesis text NOT NULL,
  declared_keys text[] NOT NULL,
  primary_metric text NOT NULL,
  practical_effect_threshold numeric NOT NULL,
  multiplicity_method text NOT NULL DEFAULT 'benjamini_hochberg',
  holdout_policy text NOT NULL,
  status text NOT NULL DEFAULT 'declared',
  declared_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT experiments_status_chk CHECK (status IN ('declared','running','closed')),
  CONSTRAINT experiments_declared_keys_chk CHECK (array_length(declared_keys, 1) >= 1)
);

GRANT ALL ON public.experiments TO service_role;
ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
-- Internal research table: deny-all to anon/authenticated by design; read via
-- the admin RPC only.

CREATE TABLE IF NOT EXISTS public.experiment_arms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  hypothesis_key text NOT NULL,
  arm_label text NOT NULL,
  n_observations integer NOT NULL DEFAULT 0,
  cluster_n integer NOT NULL DEFAULT 0,
  point_estimate numeric,
  ci_lo numeric,
  ci_hi numeric,
  p_value numeric,
  q_value numeric,
  r_basis text,
  stat_method text,
  stat_version smallint,
  rng_seed integer,
  run_id text,
  evidence_level text NOT NULL DEFAULT 'insufficient',
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiment_arms_identity UNIQUE (experiment_id, hypothesis_key, arm_label),
  CONSTRAINT experiment_arms_basis_chk CHECK (r_basis IS NULL OR r_basis IN ('plan','actual_risk')),
  CONSTRAINT experiment_arms_evidence_chk CHECK (evidence_level IN ('insufficient','descriptive','suggestive','actionable'))
);

GRANT ALL ON public.experiment_arms TO service_role;
ALTER TABLE public.experiment_arms ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_admin_experiments()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'computed_at', now(),
    'experiments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'family_key', e.family_key,
        'hypothesis', e.hypothesis,
        'declared_keys', e.declared_keys,
        'primary_metric', e.primary_metric,
        'practical_effect_threshold', e.practical_effect_threshold,
        'multiplicity_method', e.multiplicity_method,
        'holdout_policy', e.holdout_policy,
        'status', e.status,
        'declared_at', e.declared_at,
        'arms', coalesce((
          SELECT jsonb_agg(to_jsonb(a) ORDER BY a.hypothesis_key, a.arm_label)
          FROM public.experiment_arms a WHERE a.experiment_id = e.id
        ), '[]'::jsonb)
      ) ORDER BY e.declared_at DESC)
      FROM public.experiments e
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_admin_experiments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_experiments() TO authenticated, service_role;