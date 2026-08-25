-- ============================================================
-- Phase A2A dark infrastructure and A1-R recovery hardening
-- Additive only. No Wave 1 activation, no schedules, no destructive writes.
-- ============================================================

-- A1-R4: Persist the pre-suspension authority and make recovery use only it.
ALTER TABLE public.instrument_lifecycle
  ADD COLUMN IF NOT EXISTS pre_suspension_stage public.instrument_stage NULL;

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
  _pre_suspension text;
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

  SELECT stage::text, pre_suspension_stage::text
    INTO _current, _pre_suspension
  FROM public.instrument_lifecycle
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

  _rank_from := CASE _current
    WHEN 'disabled' THEN 0 WHEN 'suspended' THEN 0
    WHEN 'data_validation' THEN 1 WHEN 'shadow' THEN 2
    WHEN 'signals_only' THEN 3 WHEN 'execution_approved' THEN 4 END;
  _rank_to := CASE _to
    WHEN 'disabled' THEN 0 WHEN 'suspended' THEN 0
    WHEN 'data_validation' THEN 1 WHEN 'shadow' THEN 2
    WHEN 'signals_only' THEN 3 WHEN 'execution_approved' THEN 4 END;

  IF _to = 'suspended' THEN
    _allowed := true;
  ELSIF _to = 'disabled' THEN
    _allowed := true;
  ELSIF _current = 'suspended' THEN
    _allowed := _pre_suspension IS NOT NULL AND _to = _pre_suspension;
  ELSIF _rank_to = _rank_from + 1 THEN
    _allowed := true;
  ELSIF _rank_to < _rank_from THEN
    _allowed := true;
  END IF;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'transition % -> % is not permitted for %', _current, _to, _symbol;
  END IF;

  INSERT INTO public.instrument_lifecycle_transitions
    (symbol, from_stage, to_stage, reason, approver, evidence,
     strategy_model_version, code_hash, rollback_target)
  VALUES
    (_symbol, _current::public.instrument_stage, _to::public.instrument_stage, _reason, _approver, _evidence,
     _strategy_model_version, _code_hash,
     CASE WHEN _current = 'suspended' THEN _pre_suspension ELSE coalesce(_rollback_target, _current) END::public.instrument_stage);

  UPDATE public.instrument_lifecycle
  SET stage = _to::public.instrument_stage,
      pre_suspension_stage = CASE
        WHEN _to = 'suspended' THEN coalesce(pre_suspension_stage, _current::public.instrument_stage)
        WHEN _to = 'disabled' THEN NULL
        WHEN _current = 'suspended' THEN NULL
        ELSE pre_suspension_stage
      END
  WHERE symbol = _symbol;

  RETURN jsonb_build_object('ok', true, 'symbol', _symbol, 'from', _current, 'to', _to, 'noop', false);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_instrument_stage(text,text,text,text,text,jsonb,text,smallint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_instrument_stage(text,text,text,text,text,jsonb,text,smallint,text) FROM anon;
REVOKE ALL ON FUNCTION public.transition_instrument_stage(text,text,text,text,text,jsonb,text,smallint,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_instrument_stage(text,text,text,text,text,jsonb,text,smallint,text) TO service_role;

-- Execution ledger reconstruction fields for submitted broker-grid geometry.
ALTER TABLE public.execution_deliveries
  ADD COLUMN IF NOT EXISTS published_entry numeric,
  ADD COLUMN IF NOT EXISTS published_stop numeric,
  ADD COLUMN IF NOT EXISTS published_target numeric,
  ADD COLUMN IF NOT EXISTS price_grid_tick numeric,
  ADD COLUMN IF NOT EXISTS price_grid_source text,
  ADD COLUMN IF NOT EXISTS price_grid_moved boolean,
  ADD COLUMN IF NOT EXISTS submitted_quantity_sizing_model smallint,
  ADD COLUMN IF NOT EXISTS submitted_quantity_spec_source text,
  ADD COLUMN IF NOT EXISTS submitted_quantity_spec_as_of timestamptz;

-- Replay metadata columns required for isolated candidate cohorts.
ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS resolver_version smallint,
  ADD COLUMN IF NOT EXISTS candle_finality_policy text;

CREATE TABLE IF NOT EXISTS public.spread_sampler_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  sampler_version smallint NOT NULL,
  expected_instruments text[] NOT NULL,
  attempted_instruments text[] NOT NULL DEFAULT '{}',
  succeeded_instruments text[] NOT NULL DEFAULT '{}',
  invalid_samples integer NOT NULL DEFAULT 0,
  failed_requests integer NOT NULL DEFAULT 0,
  stage_skipped text[] NOT NULL DEFAULT '{}',
  breaker_skipped text[] NOT NULL DEFAULT '{}',
  duplicate_source_times integer NOT NULL DEFAULT 0,
  provider_outage boolean NOT NULL DEFAULT false,
  timed_out boolean NOT NULL DEFAULT false,
  request_count integer NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0,
  duration_ms integer NULL,
  error_class text NULL,
  killed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spread_sampler_runs_unique_tick UNIQUE (scheduled_at, sampler_version)
);
GRANT ALL ON public.spread_sampler_runs TO service_role;
ALTER TABLE public.spread_sampler_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages spread sampler runs" ON public.spread_sampler_runs;
CREATE POLICY "service role manages spread sampler runs"
  ON public.spread_sampler_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.instrument_atr_snapshots (
  id bigserial PRIMARY KEY,
  instrument text NOT NULL,
  timeframe text NOT NULL,
  atr numeric(20,10) NOT NULL,
  atr_period smallint NOT NULL,
  atr_version smallint NOT NULL,
  candle_as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instrument_atr_snapshots_positive CHECK (atr > 0)
);
GRANT ALL ON public.instrument_atr_snapshots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.instrument_atr_snapshots_id_seq TO service_role;
ALTER TABLE public.instrument_atr_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages atr snapshots" ON public.instrument_atr_snapshots;
CREATE POLICY "service role manages atr snapshots"
  ON public.instrument_atr_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS instrument_atr_snapshots_latest
  ON public.instrument_atr_snapshots (instrument, timeframe, candle_as_of DESC);

CREATE TABLE IF NOT EXISTS public.instrument_spread_samples (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.spread_sampler_runs(run_id) ON DELETE CASCADE,
  instrument text NOT NULL,
  provider_symbol text NOT NULL,
  scope text NOT NULL DEFAULT 'scanner',
  stage public.instrument_stage NOT NULL,
  bid numeric(20,10) NULL,
  ask numeric(20,10) NULL,
  mid numeric(20,10) NULL,
  spread_price numeric(20,10) NULL,
  spread_points numeric(20,6) NULL,
  spread_pips numeric(20,6) NULL,
  digits smallint NULL,
  point numeric(20,10) NULL,
  tick_size numeric(20,10) NULL,
  atr_snapshot_id bigint NULL REFERENCES public.instrument_atr_snapshots(id) ON DELETE SET NULL,
  spread_atr_fraction numeric(12,8) NULL,
  session text NULL,
  session_version smallint NOT NULL,
  source_time timestamptz NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  mapping_verified_at timestamptz NULL,
  spec_as_of timestamptz NULL,
  market_state text NOT NULL,
  quality text NOT NULL,
  quality_reasons text[] NOT NULL DEFAULT '{}',
  sampler_version smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instrument_spread_samples_quality CHECK (quality = ANY (ARRAY['valid','stale','future_dated','closed_market','malformed','inverted'])),
  CONSTRAINT instrument_spread_samples_valid_geometry CHECK (quality <> 'valid' OR (bid IS NOT NULL AND ask IS NOT NULL AND ask > bid AND source_time IS NOT NULL))
);
GRANT ALL ON public.instrument_spread_samples TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.instrument_spread_samples_id_seq TO service_role;
ALTER TABLE public.instrument_spread_samples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages spread samples" ON public.instrument_spread_samples;
CREATE POLICY "service role manages spread samples"
  ON public.instrument_spread_samples FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS instrument_spread_samples_source_unique
  ON public.instrument_spread_samples (instrument, scope, source_time, sampler_version)
  WHERE source_time IS NOT NULL;
CREATE INDEX IF NOT EXISTS instrument_spread_samples_latest
  ON public.instrument_spread_samples (instrument, created_at DESC);
CREATE INDEX IF NOT EXISTS instrument_spread_samples_valid_session
  ON public.instrument_spread_samples (instrument, session, source_time)
  WHERE quality = 'valid';

CREATE OR REPLACE VIEW public.instrument_spread_samples_valid AS
SELECT *
FROM public.instrument_spread_samples
WHERE quality = 'valid';
REVOKE ALL ON public.instrument_spread_samples_valid FROM PUBLIC;
GRANT SELECT ON public.instrument_spread_samples_valid TO service_role;

CREATE TABLE IF NOT EXISTS public.instrument_spread_stats (
  instrument text NOT NULL,
  session text NOT NULL,
  session_version smallint NOT NULL,
  stage public.instrument_stage NOT NULL,
  trading_date date NOT NULL,
  scope text NOT NULL,
  computation_version smallint NOT NULL,
  raw_samples integer NOT NULL,
  valid_samples integer NOT NULL,
  excluded_samples integer NOT NULL,
  distinct_trading_days integer NOT NULL,
  session_coverage numeric(6,4) NULL,
  missingness numeric(6,4) NULL,
  p50_spread_price numeric(20,10) NULL,
  p75_spread_price numeric(20,10) NULL,
  p90_spread_price numeric(20,10) NULL,
  p95_spread_price numeric(20,10) NULL,
  p99_spread_price numeric(20,10) NULL,
  max_spread_price numeric(20,10) NULL,
  p50_spread_points numeric(20,6) NULL,
  p90_spread_points numeric(20,6) NULL,
  median_atr_fraction numeric(12,8) NULL,
  p90_atr_fraction numeric(12,8) NULL,
  coverage_start timestamptz NULL,
  coverage_end timestamptz NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument, session, session_version, stage, trading_date, scope, computation_version)
);
GRANT ALL ON public.instrument_spread_stats TO service_role;
ALTER TABLE public.instrument_spread_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages spread stats" ON public.instrument_spread_stats;
CREATE POLICY "service role manages spread stats"
  ON public.instrument_spread_stats FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.scanner_capacity_samples (
  id bigserial PRIMARY KEY,
  run_id uuid NULL,
  source text NOT NULL,
  sampled_at timestamptz NOT NULL DEFAULT now(),
  job_duration_ms integer NULL,
  cycle_duration_ms integer NULL,
  queue_age_ms integer NULL,
  stale_jobs integer NOT NULL DEFAULT 0,
  timeouts integer NOT NULL DEFAULT 0,
  chain_depth integer NULL,
  provider_requests integer NOT NULL DEFAULT 0,
  provider_errors integer NOT NULL DEFAULT 0,
  provider_throttles integer NOT NULL DEFAULT 0,
  candle_failures integer NOT NULL DEFAULT 0,
  quote_failures integer NOT NULL DEFAULT 0,
  db_write_failures integer NOT NULL DEFAULT 0,
  alert_latency_ms integer NULL,
  alert_failures integer NOT NULL DEFAULT 0,
  enqueue_latency_ms integer NULL,
  enqueue_failures integer NOT NULL DEFAULT 0,
  resolver_throughput integer NULL,
  resolver_backlog integer NULL,
  resolver_oldest_age_ms integer NULL,
  breaker_events integer NOT NULL DEFAULT 0,
  wave0_publications integer NOT NULL DEFAULT 0,
  wave0_alerts integer NOT NULL DEFAULT 0,
  wave0_execution_decisions integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.scanner_capacity_samples TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scanner_capacity_samples_id_seq TO service_role;
ALTER TABLE public.scanner_capacity_samples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages scanner capacity samples" ON public.scanner_capacity_samples;
CREATE POLICY "service role manages scanner capacity samples"
  ON public.scanner_capacity_samples FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS scanner_capacity_samples_sampled_at
  ON public.scanner_capacity_samples (sampled_at DESC);

CREATE TABLE IF NOT EXISTS public.instrument_readiness_snapshots (
  id bigserial PRIMARY KEY,
  instrument text NOT NULL,
  ready boolean NOT NULL,
  checks jsonb NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  spec_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  series jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversion jsonb NOT NULL DEFAULT '{}'::jsonb,
  spread_floor_candidate numeric(20,10) NULL,
  code_hash text NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.instrument_readiness_snapshots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.instrument_readiness_snapshots_id_seq TO service_role;
ALTER TABLE public.instrument_readiness_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages readiness snapshots" ON public.instrument_readiness_snapshots;
CREATE POLICY "service role manages readiness snapshots"
  ON public.instrument_readiness_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS instrument_readiness_snapshots_latest
  ON public.instrument_readiness_snapshots (instrument, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.execution_control_changes (
  id bigserial PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL,
  reason text NOT NULL,
  control_key text NOT NULL,
  old_value jsonb NULL,
  new_value jsonb NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT ALL ON public.execution_control_changes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.execution_control_changes_id_seq TO service_role;
ALTER TABLE public.execution_control_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages execution control changes" ON public.execution_control_changes;
CREATE POLICY "service role manages execution control changes"
  ON public.execution_control_changes FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS execution_control_changes_changed_at
  ON public.execution_control_changes (changed_at DESC);

CREATE OR REPLACE FUNCTION public.get_admin_instrument_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
    'lifecycle', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'symbol', l.symbol,
        'stage', l.stage,
        'pre_suspension_stage', l.pre_suspension_stage,
        'data_health', l.data_health,
        'updated_at', l.updated_at
      ) ORDER BY l.symbol)
      FROM public.instrument_lifecycle l
    ), '[]'::jsonb),
    'latest_readiness', coalesce((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.instrument)
      FROM (
        SELECT DISTINCT ON (r.instrument)
          r.instrument,
          r.ready,
          r.checks,
          r.mapping,
          r.spec_fields,
          r.series,
          r.conversion,
          r.spread_floor_candidate,
          r.code_hash,
          r.checked_at
        FROM public.instrument_readiness_snapshots r
        ORDER BY r.instrument, r.checked_at DESC
      ) x
    ), '[]'::jsonb),
    'spread_stats', coalesce((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.instrument, s.session)
      FROM (
        SELECT DISTINCT ON (instrument, session, stage, scope)
          instrument,
          session,
          session_version,
          stage,
          scope,
          computation_version,
          valid_samples,
          excluded_samples,
          distinct_trading_days,
          session_coverage,
          missingness,
          p50_spread_price,
          p90_spread_price,
          p95_spread_price,
          p90_atr_fraction,
          coverage_start,
          coverage_end,
          calculated_at
        FROM public.instrument_spread_stats
        ORDER BY instrument, session, stage, scope, calculated_at DESC
      ) s
    ), '[]'::jsonb),
    'sampler', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'run_id', run_id,
        'scheduled_at', scheduled_at,
        'started_at', started_at,
        'finished_at', finished_at,
        'sampler_version', sampler_version,
        'expected_instruments', expected_instruments,
        'attempted_instruments', attempted_instruments,
        'succeeded_instruments', succeeded_instruments,
        'invalid_samples', invalid_samples,
        'failed_requests', failed_requests,
        'stage_skipped', stage_skipped,
        'breaker_skipped', breaker_skipped,
        'provider_outage', provider_outage,
        'timed_out', timed_out,
        'request_count', request_count,
        'retry_count', retry_count,
        'duration_ms', duration_ms,
        'error_class', error_class,
        'killed', killed
      ) ORDER BY scheduled_at DESC)
      FROM (
        SELECT * FROM public.spread_sampler_runs ORDER BY scheduled_at DESC LIMIT 20
      ) recent_runs
    ), '[]'::jsonb),
    'capacity', coalesce((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.sampled_at DESC)
      FROM (
        SELECT source, sampled_at, job_duration_ms, cycle_duration_ms, queue_age_ms,
               stale_jobs, timeouts, provider_requests, provider_errors, provider_throttles,
               candle_failures, quote_failures, db_write_failures, alert_failures,
               enqueue_failures, resolver_throughput, resolver_backlog, resolver_oldest_age_ms,
               breaker_events, wave0_publications, wave0_alerts, wave0_execution_decisions
        FROM public.scanner_capacity_samples
        ORDER BY sampled_at DESC
        LIMIT 50
      ) c
    ), '[]'::jsonb)
  ) INTO _payload;

  RETURN _payload;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_instrument_diagnostics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_instrument_diagnostics() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_instrument_diagnostics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_instrument_diagnostics() TO service_role;