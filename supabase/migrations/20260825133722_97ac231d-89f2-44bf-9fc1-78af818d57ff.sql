-- 1. Audited setter for the lifecycle enforcement switch -----------------------
CREATE OR REPLACE FUNCTION public.set_execution_control(
  _key text,
  _value jsonb,
  _changed_by text,
  _reason text,
  _expected_old jsonb DEFAULT NULL,
  _evidence jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old jsonb;
  _new jsonb;
BEGIN
  IF coalesce(btrim(_changed_by), '') = '' OR coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'an execution control change requires a named actor and a reason';
  END IF;

  IF _key NOT IN ('lifecycle_enforced') THEN
    RAISE EXCEPTION 'unknown or not operator-settable execution control: %', _key;
  END IF;

  SELECT to_jsonb(t) -> _key INTO _old FROM public.execution_controls t WHERE id = true;

  IF _expected_old IS NOT NULL AND _old IS DISTINCT FROM _expected_old THEN
    RAISE EXCEPTION 'expected previous value % but found %', _expected_old, _old;
  END IF;

  EXECUTE format(
    'UPDATE public.execution_controls SET %I = ($1 #>> ''{}'')::boolean, updated_at = now() WHERE id = true',
    _key
  ) USING _value;

  SELECT to_jsonb(t) -> _key INTO _new FROM public.execution_controls t WHERE id = true;

  INSERT INTO public.execution_control_changes (changed_by, reason, control_key, old_value, new_value, evidence)
  VALUES (_changed_by, _reason, 'execution.' || _key, _old, _new, coalesce(_evidence, '{}'::jsonb));

  RETURN jsonb_build_object('ok', true, 'key', _key, 'old', _old, 'new', _new);
END;
$$;

REVOKE ALL ON FUNCTION public.set_execution_control(text, jsonb, text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_execution_control(text, jsonb, text, text, jsonb, jsonb) TO service_role;

-- 2. Admin commissioning diagnostics ------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_commissioning()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _payload jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'lifecycle_enforced', (SELECT lifecycle_enforced FROM public.execution_controls WHERE id = true),
    'sampler_symbols', (SELECT sampler_symbols FROM public.telemetry_controls WHERE id = true),
    'instruments', coalesce((
      SELECT jsonb_agg(row_payload ORDER BY wave, symbol)
      FROM (
        SELECT
          l.symbol,
          l.wave,
          jsonb_build_object(
            'symbol', l.symbol,
            'wave', l.wave,
            'stage', l.stage,
            'data_health', l.data_health,
            'stage_updated_at', l.updated_at,
            'sampled', (
              SELECT l.symbol = ANY (t.sampler_symbols) FROM public.telemetry_controls t WHERE t.id = true
            ),
            'provider_symbol', r.provider_symbol,
            'mapping_status', r.mapping -> 'status',
            'mapping_verified_at', r.mapping -> 'verifiedAt',
            'spec_present', (s.symbol IS NOT NULL),
            'spec_as_of', s.fetched_at,
            'spec', CASE WHEN s.symbol IS NULL THEN NULL ELSE jsonb_build_object(
              'digits', s.digits,
              'point', s.point,
              'tick_size', s.tick_size,
              'contract_size', s.contract_size,
              'volume_min', s.volume_min,
              'volume_max', s.volume_max,
              'volume_step', s.volume_step,
              'stops_level', s.stops_level,
              'trade_mode', s.trade_mode
            ) END,
            'readiness', CASE WHEN r.instrument IS NULL THEN NULL ELSE jsonb_build_object(
              'ready', r.ready,
              'checks', r.checks,
              'spec_fields', r.spec_fields,
              'series', r.series,
              'conversion_route_ready', r.conversion_route_ready,
              'conversion_data_ready', r.conversion_data_ready,
              'execution_conversion_ready', r.execution_conversion_ready,
              'candle_policy_version', r.candle_policy_version,
              'checked_at', r.checked_at
            ) END,
            'last_ready_at', (
              SELECT max(rr.checked_at) FROM public.instrument_readiness_snapshots rr
              WHERE rr.instrument = l.symbol AND rr.ready
            ),
            'calendar', CASE WHEN c.symbol IS NULL THEN NULL ELSE jsonb_build_object(
              'calendar_key', c.calendar_key,
              'calendar_version', c.calendar_version,
              'source', c.source,
              'verified', (c.source = 'broker_verified')
            ) END,
            'samples_24h', jsonb_build_object(
              'valid', coalesce(sm.valid_samples, 0),
              'invalid', coalesce(sm.invalid_samples, 0),
              'first_valid_at', sm.first_valid_at,
              'last_sample_at', sm.last_sample_at,
              'last_quality', sm.last_quality,
              'last_market_state', sm.last_market_state,
              'last_source_time', sm.last_source_time
            ),
            'breaker', jsonb_build_object(
              'available', coalesce(h.available, true),
              'consecutive_failures', coalesce(h.consecutive_failures, 0),
              'breaker_open_until', h.breaker_open_until,
              'unavailable_until', h.unavailable_until
            ),
            'scan_24h', jsonb_build_object(
              'jobs', coalesce(q.jobs, 0),
              'failed', coalesce(q.failed, 0),
              'avg_duration_ms', q.avg_duration_ms,
              'max_duration_ms', q.max_duration_ms
            ),
            'blockers', (
              SELECT coalesce(jsonb_agg(b), '[]'::jsonb) FROM (
                SELECT 'no_readiness_check' AS b WHERE r.instrument IS NULL
                UNION ALL
                SELECT 'readiness_failed' WHERE r.instrument IS NOT NULL AND NOT r.ready
                UNION ALL
                SELECT 'no_provider_specification' WHERE s.symbol IS NULL
                UNION ALL
                SELECT 'no_provider_symbol' WHERE coalesce(r.provider_symbol, '') = ''
                UNION ALL
                SELECT 'calendar_unverified' WHERE c.symbol IS NULL OR c.source <> 'broker_verified'
                UNION ALL
                SELECT 'no_valid_spread_sample' WHERE coalesce(sm.valid_samples, 0) = 0
                UNION ALL
                SELECT 'breaker_open' WHERE h.breaker_open_until IS NOT NULL AND h.breaker_open_until > now()
              ) blockers
            )
          ) AS row_payload
        FROM public.instrument_lifecycle l
        LEFT JOIN public.broker_symbol_specs s ON s.symbol = l.symbol
        LEFT JOIN LATERAL (
          SELECT * FROM public.instrument_readiness_snapshots x
          WHERE x.instrument = l.symbol
          ORDER BY x.checked_at DESC LIMIT 1
        ) r ON true
        LEFT JOIN public.instrument_calendar_bindings c ON c.symbol = l.symbol
        LEFT JOIN public.instrument_health h ON h.instrument = l.symbol
        LEFT JOIN LATERAL (
          SELECT
            count(*) FILTER (WHERE g.quality = 'valid') AS valid_samples,
            count(*) FILTER (WHERE g.quality <> 'valid') AS invalid_samples,
            min(g.source_time) FILTER (WHERE g.quality = 'valid') AS first_valid_at,
            max(g.created_at) AS last_sample_at,
            (array_agg(g.quality ORDER BY g.created_at DESC))[1] AS last_quality,
            (array_agg(g.market_state ORDER BY g.created_at DESC))[1] AS last_market_state,
            (array_agg(g.source_time ORDER BY g.created_at DESC))[1] AS last_source_time
          FROM public.instrument_spread_samples g
          WHERE g.instrument = l.symbol AND g.created_at > now() - interval '24 hours'
        ) sm ON true
        LEFT JOIN LATERAL (
          SELECT
            count(*) AS jobs,
            count(*) FILTER (WHERE j.status = 'failed') AS failed,
            avg(extract(epoch FROM (j.finished_at - j.started_at)) * 1000)::numeric(12,1) AS avg_duration_ms,
            max(extract(epoch FROM (j.finished_at - j.started_at)) * 1000)::numeric(12,1) AS max_duration_ms
          FROM public.scan_queue j
          WHERE j.instrument = l.symbol AND j.enqueued_at > now() - interval '24 hours'
        ) q ON true
      ) rows
    ), '[]'::jsonb)
  ) INTO _payload;

  RETURN _payload;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_commissioning() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_commissioning() TO authenticated, service_role;