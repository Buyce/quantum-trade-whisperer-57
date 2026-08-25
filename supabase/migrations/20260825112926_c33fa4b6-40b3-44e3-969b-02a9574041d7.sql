-- ============================================================
-- Phase A2A boundary hardening: atomic lifecycle/claim/enrolment RPCs
-- Additive only. No Wave 1 activation, no schedules, no data seeding.
-- ============================================================

CREATE OR REPLACE FUNCTION public.instrument_capability_allowed(
  _instrument text,
  _capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _enforced boolean := false;
  _stage public.instrument_stage;
  _allowed boolean := false;
BEGIN
  IF coalesce(btrim(_instrument), '') = '' THEN
    RETURN jsonb_build_object('allowed', false, 'stage', NULL, 'reason', 'missing instrument');
  END IF;

  SELECT coalesce(lifecycle_enforced, false)
    INTO _enforced
  FROM public.execution_controls
  WHERE id = true;

  _enforced := coalesce(_enforced, false);

  SELECT stage
    INTO _stage
  FROM public.instrument_lifecycle
  WHERE symbol = _instrument;

  -- Matches the application lifecycle contract: while enforcement is off, legacy
  -- behaviour is preserved; once enforcement is on, the stage is authoritative.
  IF NOT _enforced THEN
    RETURN jsonb_build_object('allowed', true, 'stage', _stage, 'reason', NULL);
  END IF;

  IF _stage IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'stage', NULL,
      'reason', format('lifecycle stage for %s is unreadable', _instrument)
    );
  END IF;

  _allowed := CASE _capability
    WHEN 'collect_data' THEN _stage IN ('data_validation','shadow','signals_only','execution_approved')
    WHEN 'evaluate_strategy' THEN _stage IN ('shadow','signals_only','execution_approved')
    WHEN 'capture_research' THEN _stage IN ('shadow','signals_only','execution_approved')
    WHEN 'resolve_research' THEN _stage IN ('shadow','signals_only','execution_approved')
    WHEN 'publish' THEN _stage IN ('signals_only','execution_approved')
    WHEN 'alert' THEN _stage IN ('signals_only','execution_approved')
    WHEN 'execute' THEN _stage = 'execution_approved'
    ELSE false
  END;

  RETURN jsonb_build_object(
    'allowed', _allowed,
    'stage', _stage,
    'reason', CASE WHEN _allowed THEN NULL ELSE format('%s is at stage "%s", which does not allow %s', _instrument, _stage, _capability) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.instrument_capability_allowed(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instrument_capability_allowed(text,text) FROM anon;
REVOKE ALL ON FUNCTION public.instrument_capability_allowed(text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.instrument_capability_allowed(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_and_enrol_model_shadow(
  _claim_model_version smallint,
  _structure_key text,
  _cooldown_minutes integer,
  _instrument text,
  _grade text,
  _direction text,
  _detected_at timestamptz,
  _entry_price numeric,
  _stop_loss numeric,
  _tp1 numeric,
  _tp2 numeric,
  _tp3 numeric,
  _tp1_r numeric,
  _tp2_r numeric,
  _tp3_r numeric,
  _max_r numeric,
  _risk_price numeric,
  _atr numeric,
  _trading_session text,
  _model_version smallint,
  _observation_key text,
  _strategy_family text,
  _quality_grade text,
  _entry_source text DEFAULT NULL,
  _stop_anchor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _gate jsonb;
  _affected integer := 0;
  _plan_id uuid;
BEGIN
  _gate := public.instrument_capability_allowed(_instrument, 'resolve_research');
  IF coalesce((_gate ->> 'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('inserted', false, 'claimed', false, 'reason', 'lifecycle_refused', 'gate', _gate);
  END IF;

  IF coalesce(btrim(_structure_key), '') = '' THEN
    RETURN jsonb_build_object('inserted', false, 'claimed', false, 'reason', 'missing_structure_key');
  END IF;

  INSERT INTO public.v2_structure_claims (model_version, structure_key)
  VALUES (_claim_model_version, _structure_key)
  ON CONFLICT (model_version, structure_key) DO UPDATE
     SET claimed_at = now()
   WHERE public.v2_structure_claims.claimed_at < now() - make_interval(mins => _cooldown_minutes);
  GET DIAGNOSTICS _affected = ROW_COUNT;

  IF _affected <= 0 THEN
    RETURN jsonb_build_object('inserted', false, 'claimed', false, 'reason', 'claim_lost');
  END IF;

  INSERT INTO public.shadow_executions (
    signal_id,
    instrument,
    grade,
    direction,
    detected_at,
    entry_price,
    stop_loss,
    tp1,
    tp2,
    tp3,
    tp1_r,
    tp2_r,
    tp3_r,
    max_r,
    risk_price,
    atr,
    trading_session,
    status,
    replay_cursor,
    model_version,
    observation_key,
    strategy_family,
    quality_grade,
    entry_source,
    stop_anchor
  ) VALUES (
    NULL,
    _instrument,
    _grade::public.signal_grade,
    _direction::public.trade_direction,
    _detected_at,
    _entry_price,
    _stop_loss,
    _tp1,
    _tp2,
    _tp3,
    _tp1_r,
    _tp2_r,
    _tp3_r,
    _max_r,
    _risk_price,
    _atr,
    _trading_session,
    'pending',
    _detected_at,
    _model_version,
    _observation_key,
    _strategy_family,
    _quality_grade,
    _entry_source,
    _stop_anchor
  )
  RETURNING plan_id INTO _plan_id;

  RETURN jsonb_build_object('inserted', true, 'claimed', true, 'reason', NULL, 'plan_id', _plan_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_and_enrol_model_shadow(smallint,text,integer,text,text,text,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,smallint,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_and_enrol_model_shadow(smallint,text,integer,text,text,text,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,smallint,text,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_and_enrol_model_shadow(smallint,text,integer,text,text,text,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,smallint,text,text,text,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_and_enrol_model_shadow(smallint,text,integer,text,text,text,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,smallint,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.enrol_research_candidate_shadow(
  _candidate_id uuid,
  _claim_model_version smallint DEFAULT 101,
  _cooldown_minutes integer DEFAULT 120,
  _expected_plan_version smallint DEFAULT 1,
  _replay_version smallint DEFAULT 1,
  _execution_policy text DEFAULT 'legacy_best_target_touched',
  _plan_origin text DEFAULT 'counterfactual',
  _cohort text DEFAULT 'research_candidate'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _candidate public.research_candidates%ROWTYPE;
  _gate jsonb;
  _existing_plan_id uuid;
  _claim_key text;
  _affected integer := 0;
  _plan_id uuid := gen_random_uuid();
  _failed_count integer := 0;
  _failed_whitelisted boolean := true;
  _not_evaluable_count integer := 0;
BEGIN
  SELECT *
    INTO _candidate
  FROM public.research_candidates
  WHERE id = _candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', false, 'reconciled', false, 'reason', 'candidate_missing');
  END IF;

  SELECT plan_id
    INTO _existing_plan_id
  FROM public.shadow_executions
  WHERE research_candidate_id = _candidate.id
    AND replay_version = _replay_version
    AND execution_policy = _execution_policy
    AND plan_origin = _plan_origin
  LIMIT 1;

  IF _existing_plan_id IS NOT NULL THEN
    UPDATE public.research_candidates
    SET enrolled_plan_id = coalesce(enrolled_plan_id, _existing_plan_id),
        enrolled_at = coalesce(enrolled_at, now())
    WHERE id = _candidate.id
      AND enrolled_plan_id IS NULL;
    RETURN jsonb_build_object('inserted', false, 'reconciled', true, 'reason', NULL, 'plan_id', _existing_plan_id);
  END IF;

  IF _candidate.enrolled_plan_id IS NOT NULL THEN
    RETURN jsonb_build_object('inserted', false, 'reconciled', true, 'reason', NULL, 'plan_id', _candidate.enrolled_plan_id);
  END IF;

  IF _candidate.gates_complete IS NOT TRUE
     OR _candidate.counterfactual_class IS DISTINCT FROM 'executable'
     OR _candidate.cf_plan_version IS DISTINCT FROM _expected_plan_version
     OR _candidate.direction NOT IN ('long','short')
     OR _candidate.cf_grade NOT IN ('A+','A','B','C')
     OR _candidate.entry_price IS NULL
     OR _candidate.stop_loss IS NULL
     OR _candidate.atr IS NULL
     OR _candidate.risk_price IS NULL
     OR _candidate.risk_price <= 0
     OR abs(_candidate.entry_price - _candidate.stop_loss) <= 0
     OR _candidate.cf_tp1 IS NULL
     OR _candidate.cf_tp2 IS NULL
     OR _candidate.cf_tp3 IS NULL
     OR _candidate.cf_tp1_r IS NULL
     OR _candidate.cf_tp2_r IS NULL
     OR _candidate.cf_tp3_r IS NULL
     OR _candidate.cf_max_r IS NULL
     OR jsonb_typeof(_candidate.gates) <> 'array'
  THEN
    RETURN jsonb_build_object('inserted', false, 'reconciled', false, 'reason', 'not_executable');
  END IF;

  SELECT
    count(*) FILTER (WHERE elem ->> 'outcome' = 'fail'),
    coalesce(bool_and((elem ->> 'gate') = ANY (ARRAY['risk_ceiling','headroom','reachable_r'])) FILTER (WHERE elem ->> 'outcome' = 'fail'), true),
    count(*) FILTER (WHERE elem ->> 'outcome' = 'not_evaluable')
    INTO _failed_count, _failed_whitelisted, _not_evaluable_count
  FROM jsonb_array_elements(_candidate.gates) AS elem;

  IF _failed_count > 1
     OR (_failed_count = 1 AND NOT _failed_whitelisted)
     OR (_failed_count = 0 AND _candidate.terminal_stage <> 'published')
     OR (_failed_count = 0 AND _not_evaluable_count > 0)
  THEN
    RETURN jsonb_build_object('inserted', false, 'reconciled', false, 'reason', 'not_executable');
  END IF;

  _gate := public.instrument_capability_allowed(_candidate.instrument, 'resolve_research');
  IF coalesce((_gate ->> 'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('inserted', false, 'reconciled', false, 'reason', 'lifecycle_refused', 'gate', _gate);
  END IF;

  _claim_key := 'candidate:' || coalesce(_candidate.structure_key, _candidate.id::text);
  INSERT INTO public.v2_structure_claims (model_version, structure_key)
  VALUES (_claim_model_version, _claim_key)
  ON CONFLICT (model_version, structure_key) DO UPDATE
     SET claimed_at = now()
   WHERE public.v2_structure_claims.claimed_at < now() - make_interval(mins => _cooldown_minutes);
  GET DIAGNOSTICS _affected = ROW_COUNT;

  IF _affected <= 0 THEN
    RETURN jsonb_build_object('inserted', false, 'reconciled', false, 'reason', 'claim_lost');
  END IF;

  INSERT INTO public.shadow_executions (
    plan_id,
    signal_id,
    research_candidate_id,
    cohort,
    plan_origin,
    replay_version,
    execution_policy,
    instrument,
    grade,
    direction,
    detected_at,
    entry_price,
    stop_loss,
    tp1,
    tp2,
    tp3,
    tp1_r,
    tp2_r,
    tp3_r,
    max_r,
    risk_price,
    atr,
    confidence_score,
    trading_session,
    volatility_index,
    model_version,
    observation_key,
    quality_grade,
    status,
    replay_cursor,
    bars_replayed
  ) VALUES (
    _plan_id,
    NULL,
    _candidate.id,
    _cohort,
    _plan_origin,
    _replay_version,
    _execution_policy,
    _candidate.instrument,
    _candidate.cf_grade::public.signal_grade,
    _candidate.direction::public.trade_direction,
    _candidate.detected_at,
    _candidate.entry_price,
    _candidate.stop_loss,
    _candidate.cf_tp1,
    _candidate.cf_tp2,
    _candidate.cf_tp3,
    _candidate.cf_tp1_r,
    _candidate.cf_tp2_r,
    _candidate.cf_tp3_r,
    _candidate.cf_max_r,
    _candidate.risk_price,
    _candidate.atr,
    NULL,
    _candidate.trading_session,
    _candidate.volatility_index,
    _candidate.strategy_version,
    _candidate.observation_key,
    _candidate.cf_grade,
    'pending',
    _candidate.detected_at,
    0
  )
  ON CONFLICT DO NOTHING
  RETURNING plan_id INTO _existing_plan_id;

  IF _existing_plan_id IS NULL THEN
    SELECT plan_id
      INTO _existing_plan_id
    FROM public.shadow_executions
    WHERE research_candidate_id = _candidate.id
      AND replay_version = _replay_version
      AND execution_policy = _execution_policy
      AND plan_origin = _plan_origin
    LIMIT 1;

    IF _existing_plan_id IS NULL THEN
      RAISE EXCEPTION 'candidate enrolment insert conflicted without an existing execution for %', _candidate.id;
    END IF;

    UPDATE public.research_candidates
    SET enrolled_plan_id = _existing_plan_id,
        enrolled_at = now()
    WHERE id = _candidate.id
      AND enrolled_plan_id IS NULL;

    RETURN jsonb_build_object('inserted', false, 'reconciled', true, 'reason', NULL, 'plan_id', _existing_plan_id);
  END IF;

  UPDATE public.research_candidates
  SET enrolled_plan_id = _existing_plan_id,
      enrolled_at = now()
  WHERE id = _candidate.id
    AND enrolled_plan_id IS NULL;

  RETURN jsonb_build_object('inserted', true, 'reconciled', false, 'reason', NULL, 'plan_id', _existing_plan_id);
END;
$$;

REVOKE ALL ON FUNCTION public.enrol_research_candidate_shadow(uuid,smallint,integer,smallint,smallint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enrol_research_candidate_shadow(uuid,smallint,integer,smallint,smallint,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.enrol_research_candidate_shadow(uuid,smallint,integer,smallint,smallint,text,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enrol_research_candidate_shadow(uuid,smallint,integer,smallint,smallint,text,text,text) TO service_role;