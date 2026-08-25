-- =====================================================================
-- Live economic-event (news) pipeline: events, immutable revisions,
-- ingestion-run ledger, measured coverage, dark policy comparisons.
-- Engine-internal: service_role only. Admin reads go through a
-- SECURITY DEFINER diagnostics function.
-- =====================================================================

CREATE TABLE public.economic_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  -- Stable provider identity. NEVER a mutable title.
  provider_event_key TEXT NOT NULL,
  canonical_event_id TEXT NOT NULL,
  event_family TEXT NOT NULL,
  countries TEXT[] NOT NULL DEFAULT '{}',
  currencies TEXT[] NOT NULL DEFAULT '{}',
  affected_instruments TEXT[] NOT NULL DEFAULT '{}',
  affected_correlation_groups TEXT[] NOT NULL DEFAULT '{}',
  importance TEXT NOT NULL DEFAULT 'unknown',
  -- Scheduled time is NULL when the provider only publishes a calendar DATE.
  scheduled_at TIMESTAMP WITH TIME ZONE,
  scheduled_date DATE,
  original_scheduled_at TIMESTAMP WITH TIME ZONE,
  actual_published_at TIMESTAMP WITH TIME ZONE,
  timestamp_precision TEXT NOT NULL DEFAULT 'date_only',
  event_status TEXT NOT NULL DEFAULT 'scheduled',
  actual_value NUMERIC,
  forecast_value NUMERIC,
  previous_value NUMERIC,
  units TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  provider_updated_at TIMESTAMP WITH TIME ZONE,
  ingested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source_version TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  payload_checksum TEXT NOT NULL,
  -- Bounded: per-field provenance and small diagnostics only, never raw payloads.
  field_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT economic_events_identity UNIQUE (provider, provider_event_key),
  CONSTRAINT economic_events_precision_ck
    CHECK (timestamp_precision IN ('exact','date_only','unknown')),
  CONSTRAINT economic_events_status_ck
    CHECK (event_status IN ('scheduled','published','revised','postponed','cancelled','unknown')),
  CONSTRAINT economic_events_importance_ck
    CHECK (importance IN ('high','medium','low','unknown'))
);

GRANT ALL ON public.economic_events TO service_role;
ALTER TABLE public.economic_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX economic_events_schedule_idx
  ON public.economic_events (scheduled_at DESC NULLS LAST);
CREATE INDEX economic_events_family_idx
  ON public.economic_events (event_family, scheduled_at DESC NULLS LAST);
CREATE INDEX economic_events_currencies_idx
  ON public.economic_events USING GIN (currencies);
CREATE INDEX economic_events_instruments_idx
  ON public.economic_events USING GIN (affected_instruments);

CREATE TRIGGER economic_events_touch
  BEFORE UPDATE ON public.economic_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Append-only: the facts as known at each observation.
CREATE TABLE public.economic_event_revisions (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.economic_events(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  observed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  change_kind TEXT NOT NULL,
  scheduled_at TIMESTAMP WITH TIME ZONE,
  scheduled_date DATE,
  actual_published_at TIMESTAMP WITH TIME ZONE,
  event_status TEXT NOT NULL,
  actual_value NUMERIC,
  forecast_value NUMERIC,
  previous_value NUMERIC,
  timestamp_precision TEXT NOT NULL,
  provider_updated_at TIMESTAMP WITH TIME ZONE,
  source_version TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  payload_checksum TEXT NOT NULL,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT economic_event_revisions_unique UNIQUE (event_id, revision),
  CONSTRAINT economic_event_revisions_kind_ck
    CHECK (change_kind IN ('insert','value_revision','schedule_change','postponed','cancelled','status_change','republished'))
);

GRANT ALL ON public.economic_event_revisions TO service_role;
ALTER TABLE public.economic_event_revisions ENABLE ROW LEVEL SECURITY;

CREATE INDEX economic_event_revisions_event_idx
  ON public.economic_event_revisions (event_id, revision DESC);

-- Ingestion-run ledger. Provider health is derived from these rows, never
-- from the mere presence of a configured credential.
CREATE TABLE public.news_ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  job TEXT NOT NULL,
  scheduled_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  window_from TIMESTAMP WITH TIME ZONE,
  window_to TIMESTAMP WITH TIME ZONE,
  batch_status TEXT NOT NULL DEFAULT 'unknown',
  events_received INTEGER NOT NULL DEFAULT 0,
  inserts INTEGER NOT NULL DEFAULT 0,
  updates INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  revisions INTEGER NOT NULL DEFAULT 0,
  invalid_events INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  duration_ms INTEGER,
  error_class TEXT,
  -- Redacted message only: never a URL containing a credential.
  error_note TEXT,
  worker_version TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.news_ingestion_runs TO service_role;
ALTER TABLE public.news_ingestion_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX news_ingestion_runs_provider_idx
  ON public.news_ingestion_runs (provider, started_at DESC);

-- Measured coverage. There is deliberately no global "news_feed_healthy" flag.
CREATE TABLE public.news_coverage_snapshots (
  id BIGSERIAL PRIMARY KEY,
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  provider TEXT NOT NULL,
  country TEXT,
  currency TEXT,
  event_family TEXT NOT NULL,
  coverage_state TEXT NOT NULL,
  scheduled_events INTEGER NOT NULL DEFAULT 0,
  events_with_exact_time INTEGER NOT NULL DEFAULT 0,
  latest_event_at TIMESTAMP WITH TIME ZONE,
  last_successful_run_at TIMESTAMP WITH TIME ZONE,
  freshness_seconds INTEGER,
  source_version TEXT,
  mapping_version TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT news_coverage_state_ck CHECK (coverage_state IN (
    'healthy','partial','stale','unknown','provider_error',
    'authorization_error','schedule_incomplete','timestamp_incomplete','unsupported'
  ))
);

GRANT ALL ON public.news_coverage_snapshots TO service_role;
ALTER TABLE public.news_coverage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE INDEX news_coverage_snapshots_recent_idx
  ON public.news_coverage_snapshots (computed_at DESC);
CREATE INDEX news_coverage_snapshots_scope_idx
  ON public.news_coverage_snapshots (currency, event_family, computed_at DESC);

-- Dark comparison ledger: what the policy WOULD have decided.
CREATE TABLE public.news_policy_evaluations (
  id BIGSERIAL PRIMARY KEY,
  evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  boundary TEXT NOT NULL,
  instrument TEXT NOT NULL,
  wave SMALLINT,
  mode TEXT NOT NULL,
  decision TEXT NOT NULL,
  coverage_state TEXT NOT NULL,
  required_currencies TEXT[] NOT NULL DEFAULT '{}',
  required_families TEXT[] NOT NULL DEFAULT '{}',
  event_ids UUID[] NOT NULL DEFAULT '{}',
  news_snapshot_version TEXT NOT NULL,
  news_policy_version TEXT NOT NULL,
  reason TEXT,
  signal_id UUID,
  delivery_id BIGINT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT news_policy_evaluations_mode_ck CHECK (mode IN ('dark','enforcing')),
  CONSTRAINT news_policy_evaluations_decision_ck
    CHECK (decision IN ('would_allow','would_suppress','coverage_unknown','allowed','suppressed')),
  CONSTRAINT news_policy_evaluations_boundary_ck CHECK (boundary IN (
    'detection','shadow_candidate','publication','mcp_visibility',
    'alert_fanout','execution_enqueue','broker_submission'
  ))
);

GRANT ALL ON public.news_policy_evaluations TO service_role;
ALTER TABLE public.news_policy_evaluations ENABLE ROW LEVEL SECURITY;

CREATE INDEX news_policy_evaluations_recent_idx
  ON public.news_policy_evaluations (evaluated_at DESC);
CREATE INDEX news_policy_evaluations_instrument_idx
  ON public.news_policy_evaluations (instrument, evaluated_at DESC);

-- Bounded retention.
CREATE OR REPLACE FUNCTION public.purge_news_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_events INTEGER;
  deleted_runs INTEGER;
  deleted_coverage INTEGER;
  deleted_evals INTEGER;
BEGIN
  DELETE FROM public.economic_events
   WHERE COALESCE(scheduled_at, scheduled_date::timestamptz, ingested_at) < now() - INTERVAL '400 days';
  GET DIAGNOSTICS deleted_events = ROW_COUNT;

  DELETE FROM public.news_ingestion_runs WHERE started_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_runs = ROW_COUNT;

  DELETE FROM public.news_coverage_snapshots WHERE computed_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_coverage = ROW_COUNT;

  DELETE FROM public.news_policy_evaluations WHERE evaluated_at < now() - INTERVAL '180 days';
  GET DIAGNOSTICS deleted_evals = ROW_COUNT;

  RETURN jsonb_build_object(
    'events_deleted', deleted_events,
    'runs_deleted', deleted_runs,
    'coverage_deleted', deleted_coverage,
    'evaluations_deleted', deleted_evals
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_news_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_news_data() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_news_data() TO service_role;

-- Owner-gated admin diagnostics. Returns no credentials and no raw payloads.
CREATE OR REPLACE FUNCTION public.get_admin_news()
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
    'runs', COALESCE((
      SELECT jsonb_agg(r) FROM (
        SELECT provider, job, started_at, completed_at, batch_status, events_received,
               inserts, updates, duplicates, revisions, invalid_events, request_count,
               retry_count, response_status, duration_ms, error_class, error_note, worker_version
          FROM public.news_ingestion_runs
         ORDER BY started_at DESC
         LIMIT 40
      ) r
    ), '[]'::jsonb),
    'provider_health', COALESCE((
      SELECT jsonb_agg(p) FROM (
        SELECT provider,
               MAX(started_at) AS last_attempt_at,
               MAX(started_at) FILTER (WHERE batch_status IN ('ok','empty')) AS last_success_at,
               COUNT(*) FILTER (WHERE started_at > now() - INTERVAL '24 hours') AS runs_24h,
               COUNT(*) FILTER (WHERE started_at > now() - INTERVAL '24 hours'
                                  AND batch_status NOT IN ('ok','empty')) AS failures_24h
          FROM public.news_ingestion_runs
         GROUP BY provider
      ) p
    ), '[]'::jsonb),
    'coverage', COALESCE((
      SELECT jsonb_agg(c) FROM (
        SELECT DISTINCT ON (provider, currency, event_family)
               provider, country, currency, event_family, coverage_state, scheduled_events,
               events_with_exact_time, latest_event_at, last_successful_run_at,
               freshness_seconds, source_version, mapping_version, note, computed_at
          FROM public.news_coverage_snapshots
         ORDER BY provider, currency, event_family, computed_at DESC
      ) c
    ), '[]'::jsonb),
    'upcoming', COALESCE((
      SELECT jsonb_agg(e) FROM (
        SELECT canonical_event_id, provider, event_family, currencies, importance,
               scheduled_at, scheduled_date, timestamp_precision, event_status,
               affected_instruments, source_version, mapping_version
          FROM public.economic_events
         WHERE COALESCE(scheduled_at, scheduled_date::timestamptz) >= now() - INTERVAL '1 day'
         ORDER BY COALESCE(scheduled_at, scheduled_date::timestamptz) ASC
         LIMIT 40
      ) e
    ), '[]'::jsonb),
    'event_totals', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT provider, event_family, COUNT(*) AS events,
               COUNT(*) FILTER (WHERE timestamp_precision = 'exact') AS exact_time_events,
               MAX(ingested_at) AS last_ingested_at
          FROM public.economic_events
         GROUP BY provider, event_family
         ORDER BY provider, event_family
      ) t
    ), '[]'::jsonb),
    'evaluations', COALESCE((
      SELECT jsonb_agg(v) FROM (
        SELECT evaluated_at, boundary, instrument, wave, mode, decision, coverage_state,
               required_currencies, required_families, news_snapshot_version,
               news_policy_version, reason
          FROM public.news_policy_evaluations
         ORDER BY evaluated_at DESC
         LIMIT 60
      ) v
    ), '[]'::jsonb),
    'evaluation_summary', COALESCE((
      SELECT jsonb_agg(s) FROM (
        SELECT instrument, mode, decision, COUNT(*) AS n
          FROM public.news_policy_evaluations
         WHERE evaluated_at > now() - INTERVAL '7 days'
         GROUP BY instrument, mode, decision
         ORDER BY instrument, decision
      ) s
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_news() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_news() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_news() TO authenticated, service_role;