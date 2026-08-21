-- Make the observation identity index usable as an upsert arbiter.
-- A plain unique index is inferable by ON CONFLICT (run_id, instrument, model_version);
-- a partial one is not. NULL run_id rows remain unconstrained (nulls distinct).
DROP INDEX IF EXISTS public.model_observations_run_identity_key;
CREATE UNIQUE INDEX IF NOT EXISTS model_observations_run_identity_key
  ON public.model_observations (run_id, instrument, model_version);