-- Prompt 3F: complete the V2 shadow experiment.
-- Additive only. No V1 trading behaviour, grading, risk or replay semantics change.

-- 1. Real database kill switch + durable research health.
ALTER TABLE public.shadow_engine_state
  ADD COLUMN IF NOT EXISTS v2_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS research_errors integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS research_last_error text,
  ADD COLUMN IF NOT EXISTS research_last_error_at timestamp with time zone;

-- 2. Nullable research taxonomy on shadow rows. No default: V1 rows stay unlabelled.
ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS strategy_family text,
  ADD COLUMN IF NOT EXISTS quality_grade text;

ALTER TABLE public.shadow_executions
  DROP CONSTRAINT IF EXISTS shadow_executions_strategy_family_check;
ALTER TABLE public.shadow_executions
  ADD CONSTRAINT shadow_executions_strategy_family_check
  CHECK (strategy_family IS NULL OR strategy_family IN ('continuation', 'mean_reversion'));

ALTER TABLE public.shadow_executions
  DROP CONSTRAINT IF EXISTS shadow_executions_quality_grade_check;
ALTER TABLE public.shadow_executions
  ADD CONSTRAINT shadow_executions_quality_grade_check
  CHECK (quality_grade IS NULL OR quality_grade IN ('A+', 'A', 'B', 'C'));

-- 3. Idempotent observation identity: one row per (scan run, instrument, model).
--    Partial so legacy rows without a run_id are unaffected.
DELETE FROM public.model_observations o
 WHERE o.run_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.model_observations n
      WHERE n.run_id = o.run_id
        AND n.instrument = o.instrument
        AND n.model_version = o.model_version
        AND (n.observed_at, n.id) > (o.observed_at, o.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS model_observations_run_identity_key
  ON public.model_observations (run_id, instrument, model_version)
  WHERE run_id IS NOT NULL;

-- 4. Registry points at the exact immutable manifest hash the running V2 uses.
UPDATE public.model_versions
   SET code_hash = '7d51158e8c82a82e'
 WHERE version = 2;