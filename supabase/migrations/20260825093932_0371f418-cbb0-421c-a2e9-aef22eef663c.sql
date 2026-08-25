-- ============================================================
-- Phase A1 — Foundation Audit and Hardening (additive only)
-- ============================================================

-- 1. Research classification: wider, non-overlapping dispositions ------------
ALTER TABLE public.model_observations
  DROP CONSTRAINT IF EXISTS model_observations_disposition_check;

ALTER TABLE public.model_observations
  ADD CONSTRAINT model_observations_disposition_check CHECK (disposition = ANY (ARRAY[
    'published',
    'shadow_enrolled',
    'observation_only',
    'suppressed_cooldown',
    'suppressed_lifecycle',
    'suppressed_duplicate',
    'evaluation_error',
    'data_unavailable',
    'job_stale',
    'operationally_skipped',
    'none'
  ]));

ALTER TABLE public.model_observations
  ADD COLUMN IF NOT EXISTS suppression_reason text;

-- 2. Provenance (nullable, never backfilled) ---------------------------------
ALTER TABLE public.model_observations
  ADD COLUMN IF NOT EXISTS canonical_instrument text,
  ADD COLUMN IF NOT EXISTS provider_symbol text,
  ADD COLUMN IF NOT EXISTS lifecycle_stage_at_detection text,
  ADD COLUMN IF NOT EXISTS research_cohort text,
  ADD COLUMN IF NOT EXISTS session_version smallint,
  ADD COLUMN IF NOT EXISTS candle_source text,
  ADD COLUMN IF NOT EXISTS candle_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS quote_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS spec_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS mapping_verified_at timestamptz;

ALTER TABLE public.research_candidates
  ADD COLUMN IF NOT EXISTS canonical_instrument text,
  ADD COLUMN IF NOT EXISTS provider_symbol text,
  ADD COLUMN IF NOT EXISTS lifecycle_stage_at_detection text,
  ADD COLUMN IF NOT EXISTS research_cohort text,
  ADD COLUMN IF NOT EXISTS session_version smallint,
  ADD COLUMN IF NOT EXISTS candle_source text,
  ADD COLUMN IF NOT EXISTS candle_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS quote_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS spec_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS mapping_verified_at timestamptz;

-- 3. Session versioning ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.session_definitions (
  version smallint PRIMARY KEY,
  name text NOT NULL,
  algorithm text NOT NULL,
  timezone_model text NOT NULL,
  boundaries jsonb NOT NULL,
  dst_aware boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.session_definitions TO authenticated;
GRANT SELECT ON public.session_definitions TO anon;
GRANT ALL ON public.session_definitions TO service_role;

ALTER TABLE public.session_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session definitions are public reference data" ON public.session_definitions;
CREATE POLICY "session definitions are public reference data"
  ON public.session_definitions FOR SELECT
  TO anon, authenticated
  USING (true);

INSERT INTO public.session_definitions
  (version, name, algorithm, timezone_model, boundaries, dst_aware, notes)
VALUES (
  1,
  'fixed-utc-v1',
  'UTC hour-of-day buckets, evaluated on the signal detection timestamp',
  'fixed UTC, no daylight-saving adjustment',
  '{"asia":"00:00-07:00","london":"07:00-12:00","overlap":"12:00-16:00","new_york":"16:00-21:00","off_hours":"21:00-24:00"}'::jsonb,
  false,
  'The only session algorithm P-Trades has ever used. Historical rows with a NULL session_version were produced by this same algorithm but were written before the version was recorded; treat them as the "v1-unstamped" legacy cohort.'
)
ON CONFLICT (version) DO NOTHING;

ALTER TABLE public.market_context
  ADD COLUMN IF NOT EXISTS session_version smallint;

-- 4. Transactional, validated lifecycle transitions --------------------------
CREATE OR REPLACE FUNCTION public.transition_instrument_stage(
  _symbol text,
  _expected_from text,
  _to text,
  _reason text,
  _approver text,
  _evidence jsonb DEFAULT NULL,
  _rollback_target text DEFAULT NULL,
  _strategy_model_version smallint DEFAULT NULL,
  _code_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current text;
  _rank_from int;
  _rank_to int;
  _allowed boolean := false;
BEGIN
  IF coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'lifecycle transition requires a non-empty reason';
  END IF;
  IF coalesce(btrim(_approver), '') = '' THEN
    RAISE EXCEPTION 'lifecycle transition requires a named approver';
  END IF;
  IF _to IS NULL OR _to NOT IN ('disabled','data_validation','shadow','signals_only','execution_approved','suspended') THEN
    RAISE EXCEPTION 'unknown destination stage: %', coalesce(_to, '<null>');
  END IF;

  -- Row lock: concurrent transitions serialise here, so the expected-from check
  -- below cannot be evaluated against a stage another request already changed.
  SELECT stage INTO _current
  FROM instrument_lifecycle
  WHERE symbol = _symbol
  FOR UPDATE;

  IF _current IS NULL THEN
    RAISE EXCEPTION 'unknown instrument: %', _symbol;
  END IF;

  IF _expected_from IS NOT NULL AND _expected_from <> _current THEN
    RAISE EXCEPTION 'stage precondition failed: % is at "%", caller expected "%"',
      _symbol, _current, _expected_from;
  END IF;

  IF _current = _to THEN
    RETURN jsonb_build_object('ok', true, 'symbol', _symbol, 'from', _current, 'to', _to, 'noop', true);
  END IF;

  -- Allowed-transition graph.
  _rank_from := CASE _current
    WHEN 'disabled' THEN 0 WHEN 'suspended' THEN 0
    WHEN 'data_validation' THEN 1 WHEN 'shadow' THEN 2
    WHEN 'signals_only' THEN 3 WHEN 'execution_approved' THEN 4 END;
  _rank_to := CASE _to
    WHEN 'disabled' THEN 0 WHEN 'suspended' THEN 0
    WHEN 'data_validation' THEN 1 WHEN 'shadow' THEN 2
    WHEN 'signals_only' THEN 3 WHEN 'execution_approved' THEN 4 END;

  IF _to = 'suspended' OR _to = 'disabled' THEN
    -- Emergency revocation and retirement are always permitted.
    _allowed := true;
  ELSIF _current = 'suspended' THEN
    -- Recovery from suspension may only resume at or below the rollback target.
    _allowed := _rollback_target IS NOT NULL AND _to = _rollback_target;
  ELSIF _rank_to = _rank_from + 1 THEN
    -- One step forward: the only promotion shape.
    _allowed := true;
  ELSIF _rank_to < _rank_from THEN
    -- Any number of steps backward is a safe de-escalation.
    _allowed := true;
  END IF;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'transition % -> % is not permitted for %', _current, _to, _symbol;
  END IF;

  INSERT INTO instrument_lifecycle_transitions
    (symbol, from_stage, to_stage, reason, approver, evidence,
     strategy_model_version, code_hash, rollback_target)
  VALUES
    (_symbol, _current, _to, _reason, _approver, _evidence,
     _strategy_model_version, _code_hash, coalesce(_rollback_target, _current));

  UPDATE instrument_lifecycle
  SET stage = _to
  WHERE symbol = _symbol;

  RETURN jsonb_build_object('ok', true, 'symbol', _symbol, 'from', _current, 'to', _to, 'noop', false);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_instrument_stage(text,text,text,text,text,jsonb,text,smallint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_instrument_stage(text,text,text,text,text,jsonb,text,smallint,text) FROM anon;
REVOKE ALL ON FUNCTION public.transition_instrument_stage(text,text,text,text,text,jsonb,text,smallint,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_instrument_stage(text,text,text,text,text,jsonb,text,smallint,text) TO service_role;