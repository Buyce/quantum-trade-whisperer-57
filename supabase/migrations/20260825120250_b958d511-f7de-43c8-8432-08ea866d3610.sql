-- ============================================================
-- Phase A2 operational telemetry runtime (Wave 0 only).
-- Additive. No lifecycle enforcement, no Wave 1 activation, no seeded evidence.
-- ============================================================

-- 1. Kill switches, caps and budgets ----------------------------------------
CREATE TABLE IF NOT EXISTS public.telemetry_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  sampler_enabled boolean NOT NULL DEFAULT false,
  aggregation_enabled boolean NOT NULL DEFAULT false,
  retention_enabled boolean NOT NULL DEFAULT false,
  capacity_enabled boolean NOT NULL DEFAULT false,
  readiness_enabled boolean NOT NULL DEFAULT false,
  sampler_symbols text[] NOT NULL DEFAULT ARRAY['XAUUSD','GBPAUD','EURUSD'],
  max_instruments_per_run smallint NOT NULL DEFAULT 3,
  max_requests_per_run smallint NOT NULL DEFAULT 6,
  daily_request_budget integer NOT NULL DEFAULT 288,
  breaker_cooldown_minutes smallint NOT NULL DEFAULT 60,
  sample_retention_days smallint NOT NULL DEFAULT 120,
  atr_retention_days smallint NOT NULL DEFAULT 120,
  capacity_retention_days smallint NOT NULL DEFAULT 60,
  observation_retention_days smallint NOT NULL DEFAULT 30,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.telemetry_controls TO service_role;
ALTER TABLE public.telemetry_controls ENABLE ROW LEVEL SECURITY;
-- Deliberately no policy: backend-only. The Data API must never read or write it.

INSERT INTO public.telemetry_controls (
  id, sampler_enabled, aggregation_enabled, retention_enabled, capacity_enabled,
  readiness_enabled, note
) VALUES (
  true, true, true, true, true, true,
  'Wave 0 baseline telemetry. Sampling is restricted to sampler_symbols; Wave 1 stays unsampled while disabled.'
) ON CONFLICT (id) DO NOTHING;

-- 2. Audited control changes ------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_telemetry_control(
  _key text,
  _value jsonb,
  _changed_by text,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old jsonb;
  _new jsonb;
BEGIN
  IF coalesce(btrim(_changed_by), '') = '' OR coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'a telemetry control change requires a named actor and a reason';
  END IF;
  IF _key NOT IN (
    'sampler_enabled','aggregation_enabled','retention_enabled','capacity_enabled',
    'readiness_enabled','sampler_symbols','max_instruments_per_run','max_requests_per_run',
    'daily_request_budget','breaker_cooldown_minutes','sample_retention_days',
    'atr_retention_days','capacity_retention_days','observation_retention_days','note'
  ) THEN
    RAISE EXCEPTION 'unknown telemetry control: %', _key;
  END IF;

  SELECT to_jsonb(t) -> _key INTO _old FROM public.telemetry_controls t WHERE id = true;

  EXECUTE format(
    'UPDATE public.telemetry_controls SET %I = ($1 #>> ''{}'')::%s, updated_at = now() WHERE id = true',
    _key,
    CASE _key
      WHEN 'sampler_symbols' THEN 'text[]'
      WHEN 'note' THEN 'text'
      WHEN 'daily_request_budget' THEN 'integer'
      WHEN 'sampler_enabled' THEN 'boolean'
      WHEN 'aggregation_enabled' THEN 'boolean'
      WHEN 'retention_enabled' THEN 'boolean'
      WHEN 'capacity_enabled' THEN 'boolean'
      WHEN 'readiness_enabled' THEN 'boolean'
      ELSE 'smallint'
    END
  ) USING _value;

  SELECT to_jsonb(t) -> _key INTO _new FROM public.telemetry_controls t WHERE id = true;

  INSERT INTO public.execution_control_changes (changed_by, reason, control_key, old_value, new_value, evidence)
  VALUES (_changed_by, _reason, 'telemetry.' || _key, _old, _new, '{}'::jsonb);

  RETURN jsonb_build_object('ok', true, 'key', _key, 'old', _old, 'new', _new);
END;
$$;

REVOKE ALL ON FUNCTION public.set_telemetry_control(text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_telemetry_control(text,jsonb,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.set_telemetry_control(text,jsonb,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_telemetry_control(text,jsonb,text,text) TO service_role;

-- 3. One run per scheduled slot per sampler version -------------------------
CREATE OR REPLACE FUNCTION public.claim_sampler_slot(
  _scheduled_at timestamptz,
  _sampler_version smallint,
  _expected text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _run uuid := gen_random_uuid();
  _affected integer := 0;
BEGIN
  INSERT INTO public.spread_sampler_runs (run_id, scheduled_at, sampler_version, expected_instruments, started_at)
  VALUES (_run, _scheduled_at, _sampler_version, coalesce(_expected, '{}'::text[]), now())
  ON CONFLICT (scheduled_at, sampler_version) DO NOTHING;
  GET DIAGNOSTICS _affected = ROW_COUNT;
  IF _affected <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN _run;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sampler_slot(timestamptz,smallint,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_sampler_slot(timestamptz,smallint,text[]) FROM anon;
REVOKE ALL ON FUNCTION public.claim_sampler_slot(timestamptz,smallint,text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sampler_slot(timestamptz,smallint,text[]) TO service_role;

-- 4. The session windows, expressed once in SQL ----------------------------
-- Mirrors sessionOf() in src/lib/scanner/session.ts (session_definitions v1).
CREATE OR REPLACE FUNCTION public.session_of_v1(_at timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN extract(hour from _at at time zone 'UTC') >= 22 THEN 'sydney'
    WHEN extract(hour from _at at time zone 'UTC') < 1 THEN 'sydney'
    WHEN extract(hour from _at at time zone 'UTC') < 7 THEN 'tokyo'
    WHEN extract(hour from _at at time zone 'UTC') < 12 THEN 'london'
    WHEN extract(hour from _at at time zone 'UTC') < 16 THEN 'london_new_york_overlap'
    ELSE 'new_york'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.session_of_v1(timestamptz) TO service_role;

-- 5. Spread aggregation + missingness --------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_spread_stats(_days integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from timestamptz := date_trunc('day', now()) - make_interval(days => greatest(_days, 1));
  _rows integer := 0;
BEGIN
  WITH scheduled AS (
    -- Expected instrument-slots: one per scheduled run that listed the instrument.
    SELECT
      r.scheduled_at::date AS trading_date,
      public.session_of_v1(r.scheduled_at) AS session,
      inst AS instrument,
      count(*) AS expected_slots
    FROM public.spread_sampler_runs r
    CROSS JOIN LATERAL unnest(r.expected_instruments) AS inst
    WHERE r.scheduled_at >= _from
    GROUP BY 1, 2, 3
  ), agg AS (
    SELECT
      s.instrument,
      s.session,
      s.session_version,
      s.stage,
      s.received_at::date AS trading_date,
      s.scope,
      1::smallint AS computation_version,
      count(*) AS raw_samples,
      count(*) FILTER (WHERE s.quality = 'valid') AS valid_samples,
      count(*) FILTER (WHERE s.quality <> 'valid') AS excluded_samples,
      count(DISTINCT s.received_at::date) AS distinct_trading_days,
      min(s.received_at) AS coverage_start,
      max(s.received_at) AS coverage_end,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY s.spread_price) FILTER (WHERE s.quality = 'valid') AS p50_spread_price,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY s.spread_price) FILTER (WHERE s.quality = 'valid') AS p75_spread_price,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY s.spread_price) FILTER (WHERE s.quality = 'valid') AS p90_spread_price,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY s.spread_price) FILTER (WHERE s.quality = 'valid') AS p95_spread_price,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY s.spread_price) FILTER (WHERE s.quality = 'valid') AS p99_spread_price,
      max(s.spread_price) FILTER (WHERE s.quality = 'valid') AS max_spread_price,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY s.spread_points) FILTER (WHERE s.quality = 'valid') AS p50_spread_points,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY s.spread_points) FILTER (WHERE s.quality = 'valid') AS p90_spread_points,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY s.spread_atr_fraction) FILTER (WHERE s.quality = 'valid' AND s.spread_atr_fraction IS NOT NULL) AS median_atr_fraction,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY s.spread_atr_fraction) FILTER (WHERE s.quality = 'valid' AND s.spread_atr_fraction IS NOT NULL) AS p90_atr_fraction
    FROM public.instrument_spread_samples s
    WHERE s.received_at >= _from
      AND s.session IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5, 6, 7
  )
  INSERT INTO public.instrument_spread_stats (
    instrument, session, session_version, stage, trading_date, scope, computation_version,
    raw_samples, valid_samples, excluded_samples, distinct_trading_days,
    coverage_start, coverage_end,
    p50_spread_price, p75_spread_price, p90_spread_price, p95_spread_price, p99_spread_price,
    max_spread_price, p50_spread_points, p90_spread_points,
    median_atr_fraction, p90_atr_fraction,
    session_coverage, missingness, calculated_at
  )
  SELECT
    a.instrument, a.session, a.session_version, a.stage, a.trading_date, a.scope, a.computation_version,
    a.raw_samples, a.valid_samples, a.excluded_samples, a.distinct_trading_days,
    a.coverage_start, a.coverage_end,
    a.p50_spread_price, a.p75_spread_price, a.p90_spread_price, a.p95_spread_price, a.p99_spread_price,
    a.max_spread_price, a.p50_spread_points, a.p90_spread_points,
    a.median_atr_fraction, a.p90_atr_fraction,
    CASE WHEN sc.expected_slots > 0
      THEN least(1.0, a.raw_samples::numeric / sc.expected_slots)::numeric END,
    CASE WHEN sc.expected_slots > 0
      THEN greatest(0.0, 1.0 - a.valid_samples::numeric / sc.expected_slots)::numeric END,
    now()
  FROM agg a
  LEFT JOIN scheduled sc
    ON sc.instrument = a.instrument
   AND sc.session = a.session
   AND sc.trading_date = a.trading_date
  ON CONFLICT (instrument, session, session_version, stage, trading_date, scope, computation_version)
  DO UPDATE SET
    raw_samples = EXCLUDED.raw_samples,
    valid_samples = EXCLUDED.valid_samples,
    excluded_samples = EXCLUDED.excluded_samples,
    distinct_trading_days = EXCLUDED.distinct_trading_days,
    coverage_start = EXCLUDED.coverage_start,
    coverage_end = EXCLUDED.coverage_end,
    p50_spread_price = EXCLUDED.p50_spread_price,
    p75_spread_price = EXCLUDED.p75_spread_price,
    p90_spread_price = EXCLUDED.p90_spread_price,
    p95_spread_price = EXCLUDED.p95_spread_price,
    p99_spread_price = EXCLUDED.p99_spread_price,
    max_spread_price = EXCLUDED.max_spread_price,
    p50_spread_points = EXCLUDED.p50_spread_points,
    p90_spread_points = EXCLUDED.p90_spread_points,
    median_atr_fraction = EXCLUDED.median_atr_fraction,
    p90_atr_fraction = EXCLUDED.p90_atr_fraction,
    session_coverage = EXCLUDED.session_coverage,
    missingness = EXCLUDED.missingness,
    calculated_at = now();

  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'buckets', _rows, 'since', _from);
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_spread_stats(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_spread_stats(integer) FROM anon;
REVOKE ALL ON FUNCTION public.recompute_spread_stats(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_spread_stats(integer) TO service_role;

-- 6. Retention -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_telemetry()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c public.telemetry_controls%ROWTYPE;
  _samples integer := 0;
  _runs integer := 0;
  _atr integer := 0;
  _capacity integer := 0;
  _observations integer := 0;
BEGIN
  SELECT * INTO _c FROM public.telemetry_controls WHERE id = true;
  IF NOT FOUND OR _c.retention_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'retention_disabled');
  END IF;

  DELETE FROM public.instrument_spread_samples
   WHERE received_at < now() - make_interval(days => _c.sample_retention_days);
  GET DIAGNOSTICS _samples = ROW_COUNT;

  DELETE FROM public.spread_sampler_runs
   WHERE scheduled_at < now() - make_interval(days => _c.sample_retention_days);
  GET DIAGNOSTICS _runs = ROW_COUNT;

  DELETE FROM public.instrument_atr_snapshots
   WHERE created_at < now() - make_interval(days => _c.atr_retention_days);
  GET DIAGNOSTICS _atr = ROW_COUNT;

  DELETE FROM public.scanner_capacity_samples
   WHERE sampled_at < now() - make_interval(days => _c.capacity_retention_days);
  GET DIAGNOSTICS _capacity = ROW_COUNT;

  DELETE FROM public.metaapi_api_observations
   WHERE observed_at < now() - make_interval(days => _c.observation_retention_days);
  GET DIAGNOSTICS _observations = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'spread_samples', _samples,
    'sampler_runs', _runs,
    'atr_snapshots', _atr,
    'capacity_samples', _capacity,
    'api_observations', _observations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_telemetry() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_telemetry() FROM anon;
REVOKE ALL ON FUNCTION public.purge_telemetry() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_telemetry() TO service_role;

-- 7. Versioned candle-finality policy (R7) ---------------------------------
CREATE TABLE IF NOT EXISTS public.candle_policies (
  version smallint PRIMARY KEY,
  name text NOT NULL,
  finality text NOT NULL,
  applies_to text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.candle_policies TO authenticated;
GRANT SELECT ON public.candle_policies TO anon;
GRANT ALL ON public.candle_policies TO service_role;
ALTER TABLE public.candle_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "candle policies are public reference data" ON public.candle_policies;
CREATE POLICY "candle policies are public reference data"
  ON public.candle_policies FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.candle_policies (version, name, finality, applies_to, description) VALUES
  (1, 'wave0-forming-current-candle-v1', 'includes_forming_current_candle',
   'Wave 0 V1 production strategy',
   'The behaviour V1 has always had: the provider''s candle series is used exactly as returned, including the still-forming current candle. Preserved unchanged and now stamped explicitly so no later cohort can be compared against it by accident.'),
  (2, 'research-closed-candles-v1', 'closed_candles_only',
   'Wave 1 and later research cohorts',
   'Only candles whose interval has ended are read. Available for research cohorts; never applied to Wave 0 V1, because doing so would silently change historical strategy results.')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE public.model_observations
  ADD COLUMN IF NOT EXISTS candle_policy_version smallint;
ALTER TABLE public.research_candidates
  ADD COLUMN IF NOT EXISTS candle_policy_version smallint;
ALTER TABLE public.instrument_spread_samples
  ADD COLUMN IF NOT EXISTS candle_policy_version smallint;

-- 8. Readiness snapshots: live conversion evidence (R5) --------------------
ALTER TABLE public.instrument_readiness_snapshots
  ADD COLUMN IF NOT EXISTS conversion_live jsonb,
  ADD COLUMN IF NOT EXISTS conversion_route_ready boolean,
  ADD COLUMN IF NOT EXISTS conversion_data_ready boolean,
  ADD COLUMN IF NOT EXISTS execution_conversion_ready boolean,
  ADD COLUMN IF NOT EXISTS provider_symbol text,
  ADD COLUMN IF NOT EXISTS candle_policy_version smallint;