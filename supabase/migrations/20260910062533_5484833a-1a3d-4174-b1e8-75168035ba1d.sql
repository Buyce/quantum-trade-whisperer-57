ALTER TABLE public.instrument_spread_samples
  ADD COLUMN IF NOT EXISTS quote_attempts smallint,
  ADD COLUMN IF NOT EXISTS first_attempt_quality text,
  ADD COLUMN IF NOT EXISTS retry_recovered boolean;

COMMENT ON COLUMN public.instrument_spread_samples.quote_attempts IS
  'Provider requests actually spent on this measurement (bounded re-ask).';
COMMENT ON COLUMN public.instrument_spread_samples.first_attempt_quality IS
  'Classification of the FIRST answer, kept even when a later attempt was usable.';
COMMENT ON COLUMN public.instrument_spread_samples.retry_recovered IS
  'True when the first answer was unusable and a later attempt produced evidence.';

ALTER TABLE public.execution_controls
  ADD COLUMN IF NOT EXISTS auto_stage_advance_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.execution_controls.auto_stage_advance_enabled IS
  'Kill switch for automatic instrument stage advancement/demotion. Unreadable = do not run.';

CREATE OR REPLACE FUNCTION public.set_execution_control(_key text, _value jsonb, _changed_by text, _reason text, _expected_old jsonb DEFAULT NULL::jsonb, _evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _old jsonb;
  _new jsonb;
  _text text;
BEGIN
  IF coalesce(btrim(_changed_by), '') = '' OR coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'an execution control change requires a named actor and a reason';
  END IF;

  IF _key NOT IN ('lifecycle_enforced', 'max_customer_exit_policy', 'auto_stage_advance_enabled') THEN
    RAISE EXCEPTION 'unknown or not operator-settable execution control: %', _key;
  END IF;

  SELECT to_jsonb(t) -> _key INTO _old FROM public.execution_controls t WHERE id = true;

  IF _expected_old IS NOT NULL AND _old IS DISTINCT FROM _expected_old THEN
    RAISE EXCEPTION 'expected previous value % but found %', _expected_old, _old;
  END IF;

  IF _key = 'max_customer_exit_policy' THEN
    _text := _value #>> '{}';
    IF _text IS NULL OR _text NOT IN (
      'single_exit_first_target',
      'single_exit_second_target',
      'single_exit_third_target',
      'partial_tp1_runner_tp2',
      'ladder_tp1_tp2_runner_tp3'
    ) THEN
      RAISE EXCEPTION 'not a known exit policy: %', coalesce(_text, 'null');
    END IF;
    UPDATE public.execution_controls
       SET max_customer_exit_policy = _text, updated_at = now()
     WHERE id = true;
  ELSE
    EXECUTE format(
      'UPDATE public.execution_controls SET %I = ($1 #>> ''{}'')::boolean, updated_at = now() WHERE id = true',
      _key
    ) USING _value;
  END IF;

  SELECT to_jsonb(t) -> _key INTO _new FROM public.execution_controls t WHERE id = true;

  INSERT INTO public.execution_control_changes (changed_by, reason, control_key, old_value, new_value, evidence)
  VALUES (_changed_by, _reason, 'execution.' || _key, _old, _new, coalesce(_evidence, '{}'::jsonb));

  RETURN jsonb_build_object('ok', true, 'key', _key, 'old', _old, 'new', _new);
END;
$function$;