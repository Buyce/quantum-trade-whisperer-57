-- V2 grading research telemetry.
-- Records every V1/V2 evaluation outcome per scan observation, plus a race-safe
-- cooldown claim table for V2 research structures. No trading behaviour changes.

CREATE TABLE public.model_observations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid,
  observation_key text,
  model_version smallint NOT NULL,
  instrument text NOT NULL,
  observed_at timestamp with time zone NOT NULL DEFAULT now(),
  decision text NOT NULL CHECK (decision IN ('candidate', 'no_trade', 'error')),
  family text CHECK (family IN ('continuation', 'mean_reversion')),
  grade text,
  direction text CHECK (direction IN ('long', 'short')),
  disposition text NOT NULL DEFAULT 'none'
    CHECK (disposition IN ('published', 'shadow_enrolled', 'observation_only', 'suppressed_cooldown', 'none')),
  reason text,
  code_hash text,
  latency_ms integer,
  signal_id uuid REFERENCES public.scanned_signals(id) ON DELETE SET NULL,
  profile jsonb
);

CREATE INDEX model_observations_version_time_idx
  ON public.model_observations (model_version, observed_at DESC);
CREATE INDEX model_observations_run_idx ON public.model_observations (run_id);

GRANT ALL ON public.model_observations TO service_role;
ALTER TABLE public.model_observations ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated grants and no policies: research telemetry is reachable
-- only through the privileged admin path, exactly like shadow_executions.

CREATE TABLE public.v2_structure_claims (
  model_version smallint NOT NULL,
  structure_key text NOT NULL,
  claimed_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (model_version, structure_key)
);

GRANT ALL ON public.v2_structure_claims TO service_role;
ALTER TABLE public.v2_structure_claims ENABLE ROW LEVEL SECURITY;

-- Atomic cooldown claim: true only for the caller that wins the structure.
CREATE OR REPLACE FUNCTION public.claim_v2_structure(
  _model_version smallint,
  _structure_key text,
  _cooldown_minutes integer DEFAULT 120
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected integer;
BEGIN
  INSERT INTO public.v2_structure_claims (model_version, structure_key)
  VALUES (_model_version, _structure_key)
  ON CONFLICT (model_version, structure_key) DO UPDATE
     SET claimed_at = now()
   WHERE v2_structure_claims.claimed_at < now() - make_interval(mins => _cooldown_minutes);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

-- Prune stale claims alongside the existing queue maintenance cadence.
CREATE OR REPLACE FUNCTION public.prune_v2_structure_claims()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.v2_structure_claims WHERE claimed_at < now() - interval '7 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

-- Register model version 2 before any V2 observation is written.
INSERT INTO public.model_versions (version, label, components, code_hash, notes)
VALUES (
  2,
  'v2-canonical-abc-research',
  jsonb_build_object(
    'pointC', jsonb_build_object('retracementMin', 0.382, 'retracementMax', 0.886, 'pivotLookback', 2),
    'barrier', jsonb_build_object('h4PivotLookback', 5, 'pivotMinSeparationAtr', 0.3, 'openSpaceExtensionAtr', 6),
    'pillars', jsonb_build_object('zoneMaxDistanceAtr', 1.5, 'zoneNormalisation', 'native-timeframe Wilder ATR at zone bar', 'volatility', 'continuous piecewise-linear'),
    'policy', jsonb_build_object('published', false, 'shadowEnrolled', 'continuation only', 'meanReversion', 'observation only')
  ),
  NULL,
  'Research-only grading model. Never published to users; evaluated on every successful scan observation alongside V1.'
)
ON CONFLICT (version) DO NOTHING;