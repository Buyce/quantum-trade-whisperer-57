-- ============================================================================
-- Prompt 14 — Stage 5 + Stage 3/4 closure
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Connected accounts: exposure boundary, research consent, arming audit
-- ---------------------------------------------------------------------------
ALTER TABLE public.connected_trading_accounts
  ADD COLUMN IF NOT EXISTS max_account_open_positions integer,
  ADD COLUMN IF NOT EXISTS max_account_exposure_note text,
  ADD COLUMN IF NOT EXISTS research_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS research_consent_version integer,
  ADD COLUMN IF NOT EXISTS research_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS research_account_ref text
    DEFAULT ('ra_' || replace(gen_random_uuid()::text, '-', '')),
  ADD COLUMN IF NOT EXISTS mode_armed_at timestamptz,
  ADD COLUMN IF NOT EXISTS mode_armed_config_version integer,
  ADD COLUMN IF NOT EXISTS stand_down_reason text;

UPDATE public.connected_trading_accounts
   SET research_account_ref = 'ra_' || replace(gen_random_uuid()::text, '-', '')
 WHERE research_account_ref IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_research_ref_uidx
  ON public.connected_trading_accounts (research_account_ref);

-- ---------------------------------------------------------------------------
-- 2. Benchmark policy — persisted, versioned, operator-owned
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.benchmark_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  dry_run boolean NOT NULL DEFAULT true,
  min_grade text NOT NULL DEFAULT 'B' CHECK (min_grade IN ('A+', 'A', 'B')),
  instruments text[] NOT NULL DEFAULT '{}',
  risk_percent numeric CHECK (risk_percent IS NULL OR (risk_percent > 0 AND risk_percent <= 5)),
  max_concurrent_risk numeric CHECK (max_concurrent_risk IS NULL OR max_concurrent_risk > 0),
  daily_order_cap integer CHECK (daily_order_cap IS NULL OR daily_order_cap > 0),
  benchmark_account_id uuid REFERENCES public.connected_trading_accounts (id) ON DELETE SET NULL,
  policy_version integer NOT NULL DEFAULT 1,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.benchmark_policy TO authenticated;
GRANT ALL ON public.benchmark_policy TO service_role;
ALTER TABLE public.benchmark_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read benchmark policy" ON public.benchmark_policy;
CREATE POLICY "admins read benchmark policy"
  ON public.benchmark_policy FOR SELECT TO authenticated
  USING (public.is_admin());

INSERT INTO public.benchmark_policy (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bump_benchmark_policy_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.enabled, NEW.dry_run, NEW.min_grade, NEW.instruments, NEW.risk_percent,
      NEW.max_concurrent_risk, NEW.daily_order_cap, NEW.benchmark_account_id)
     IS DISTINCT FROM
     (OLD.enabled, OLD.dry_run, OLD.min_grade, OLD.instruments, OLD.risk_percent,
      OLD.max_concurrent_risk, OLD.daily_order_cap, OLD.benchmark_account_id)
  THEN
    NEW.policy_version := OLD.policy_version + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS benchmark_policy_version ON public.benchmark_policy;
CREATE TRIGGER benchmark_policy_version
  BEFORE UPDATE ON public.benchmark_policy
  FOR EACH ROW EXECUTE FUNCTION public.bump_benchmark_policy_version();

REVOKE ALL ON FUNCTION public.bump_benchmark_policy_version() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stage-4 research governance on broker evidence
-- ---------------------------------------------------------------------------
ALTER TABLE public.broker_trade_evidence
  ADD COLUMN IF NOT EXISTS evidence_phase text NOT NULL DEFAULT 'development',
  ADD COLUMN IF NOT EXISTS news_context text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS research_account_ref text,
  ADD COLUMN IF NOT EXISTS research_consent boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broker_evidence_phase_chk'
  ) THEN
    ALTER TABLE public.broker_trade_evidence
      ADD CONSTRAINT broker_evidence_phase_chk
      CHECK (evidence_phase IN ('development', 'validation', 'forward_holdout'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broker_evidence_news_chk'
  ) THEN
    ALTER TABLE public.broker_trade_evidence
      ADD CONSTRAINT broker_evidence_news_chk
      CHECK (news_context = 'unknown');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_evidence_phase_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.resolved_at IS NOT NULL
     AND NEW.evidence_phase IS DISTINCT FROM OLD.evidence_phase THEN
    RAISE EXCEPTION 'evidence_phase_locked_after_outcome';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS broker_evidence_phase_lock ON public.broker_trade_evidence;
CREATE TRIGGER broker_evidence_phase_lock
  BEFORE UPDATE ON public.broker_trade_evidence
  FOR EACH ROW EXECUTE FUNCTION public.enforce_evidence_phase_lock();

-- ---------------------------------------------------------------------------
-- 4. Broker telemetry snapshots (MetaStats)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_telemetry_snapshots (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.connected_trading_accounts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'metastats',
  status text NOT NULL CHECK (status IN ('ok', 'processing', 'unavailable')),
  reason text,
  retry_after_seconds integer,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_telemetry_recent_idx
  ON public.account_telemetry_snapshots (account_id, observed_at DESC);

GRANT SELECT ON public.account_telemetry_snapshots TO authenticated;
GRANT ALL ON public.account_telemetry_snapshots TO service_role;
ALTER TABLE public.account_telemetry_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners read telemetry" ON public.account_telemetry_snapshots;
CREATE POLICY "owners read telemetry"
  ON public.account_telemetry_snapshots FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. Risk Guardian trackers and observed breaches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_risk_trackers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.connected_trading_accounts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  vendor_tracker_id text,
  name text NOT NULL,
  period text NOT NULL CHECK (period IN ('day', 'week', 'month', 'lifetime')),
  threshold_kind text NOT NULL CHECK (threshold_kind IN ('relative_drawdown', 'absolute_drawdown')),
  threshold_value numeric NOT NULL CHECK (threshold_value > 0),
  supported boolean NOT NULL DEFAULT true,
  unsupported_reason text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, period, threshold_kind)
);

GRANT SELECT ON public.account_risk_trackers TO authenticated;
GRANT ALL ON public.account_risk_trackers TO service_role;
ALTER TABLE public.account_risk_trackers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners read risk trackers" ON public.account_risk_trackers;
CREATE POLICY "owners read risk trackers"
  ON public.account_risk_trackers FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

CREATE TABLE IF NOT EXISTS public.account_risk_events (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.connected_trading_accounts (id) ON DELETE CASCADE,
  tracker_id uuid NOT NULL REFERENCES public.account_risk_trackers (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  exceeded_threshold_type text,
  absolute_drawdown numeric,
  relative_drawdown numeric,
  event_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tracker_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS account_risk_events_recent_idx
  ON public.account_risk_events (account_id, event_at DESC);

GRANT SELECT ON public.account_risk_events TO authenticated;
GRANT ALL ON public.account_risk_events TO service_role;
ALTER TABLE public.account_risk_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners read risk events" ON public.account_risk_events;
CREATE POLICY "owners read risk events"
  ON public.account_risk_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. Durable vendor budget
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telemetry_budget (
  account_id uuid NOT NULL REFERENCES public.connected_trading_accounts (id) ON DELETE CASCADE,
  source text NOT NULL,
  next_allowed_at timestamptz NOT NULL DEFAULT now(),
  last_claimed_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  parked_reason text,
  PRIMARY KEY (account_id, source)
);

GRANT ALL ON public.telemetry_budget TO service_role;
ALTER TABLE public.telemetry_budget ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_account_telemetry(
  _account_id uuid,
  _source text,
  _min_interval_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed boolean := false;
BEGIN
  INSERT INTO public.telemetry_budget (account_id, source, next_allowed_at, last_claimed_at)
  VALUES (_account_id, _source,
          now() + make_interval(secs => GREATEST(_min_interval_seconds, 1)), now())
  ON CONFLICT (account_id, source) DO UPDATE
    SET next_allowed_at = now() + make_interval(secs => GREATEST(_min_interval_seconds, 1)),
        last_claimed_at = now()
  WHERE public.telemetry_budget.next_allowed_at <= now()
    AND public.telemetry_budget.parked_reason IS NULL
  RETURNING true INTO claimed;

  RETURN COALESCE(claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_account_telemetry(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_telemetry(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.park_account_telemetry(
  _account_id uuid,
  _source text,
  _reason text,
  _retry_after_seconds integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.telemetry_budget (account_id, source, next_allowed_at, parked_reason,
                                       consecutive_failures)
  VALUES (_account_id, _source,
          now() + make_interval(secs => GREATEST(COALESCE(_retry_after_seconds, 3600), 1)),
          _reason, 1)
  ON CONFLICT (account_id, source) DO UPDATE
    SET next_allowed_at = now()
          + make_interval(secs => GREATEST(COALESCE(_retry_after_seconds, 3600), 1)),
        parked_reason = _reason,
        consecutive_failures = public.telemetry_budget.consecutive_failures + 1;
$$;

REVOKE ALL ON FUNCTION public.park_account_telemetry(uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.park_account_telemetry(uuid, text, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Vendor API observability (latency / errors / cost units)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metaapi_api_observations (
  id bigserial PRIMARY KEY,
  surface text NOT NULL,
  account_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'error', 'timeout', 'rate_limited', 'refused')),
  http_status integer,
  latency_ms integer,
  cost_units integer NOT NULL DEFAULT 1,
  detail text,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS metaapi_api_obs_recent_idx
  ON public.metaapi_api_observations (observed_at DESC);

GRANT SELECT ON public.metaapi_api_observations TO authenticated;
GRANT ALL ON public.metaapi_api_observations TO service_role;
ALTER TABLE public.metaapi_api_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read api observations" ON public.metaapi_api_observations;
CREATE POLICY "admins read api observations"
  ON public.metaapi_api_observations FOR SELECT TO authenticated
  USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- 8. Enqueue: benchmark execution now runs off the persisted policy
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_execution_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo_auto boolean;
  live_auto boolean;
  pol public.benchmark_policy;
  grade_rank integer;
  min_rank integer;
  used_today integer;
BEGIN
  IF NEW.grade = 'C' THEN
    RETURN NEW;
  END IF;

  -- Customer bridge deliveries (Prompt 13), unchanged.
  INSERT INTO public.execution_deliveries (user_id, signal_id, dry_run, execution_config_version)
  SELECT s.user_id, NEW.id, COALESCE(s.execution_dry_run, true), s.execution_config_version
    FROM public.scanner_settings s
   WHERE s.execution_enabled = true
     AND s.webhook_enabled = true
     AND s.webhook_url IS NOT NULL
  ON CONFLICT (user_id, signal_id, bridge_profile) DO NOTHING;

  SELECT c.demo_auto_enabled, c.live_auto_enabled
    INTO demo_auto, live_auto
    FROM public.execution_controls c
   LIMIT 1;

  -- Customer direct deliveries, gated by the account's armed mode.
  IF COALESCE(demo_auto, false) OR COALESCE(live_auto, false) THEN
    INSERT INTO public.execution_deliveries (
      user_id, signal_id, bridge_profile, destination_type, connected_account_id,
      account_mode, dry_run, execution_config_version
    )
    SELECT a.user_id,
           NEW.id,
           'metaapi_direct:' || a.id::text,
           'metaapi_direct',
           a.id,
           a.mode,
           false,
           s.execution_config_version
      FROM public.connected_trading_accounts a
      JOIN public.scanner_settings s ON s.user_id = a.user_id
     WHERE a.disconnected_at IS NULL
       AND a.is_benchmark = false
       AND a.phase IN ('connected', 'ready')
       AND a.intent_conflict = false
       AND a.trade_allowed = true
       AND COALESCE(a.investor_mode, false) = false
       AND (
         (a.mode = 'demo_auto' AND a.broker_account_type = 'demo' AND COALESCE(demo_auto, false))
         OR (a.mode = 'live_auto' AND a.broker_account_type = 'real' AND COALESCE(live_auto, false))
       )
    ON CONFLICT DO NOTHING;
  END IF;

  -- ---- Benchmark: operator-owned, versioned policy ------------------------
  SELECT * INTO pol FROM public.benchmark_policy WHERE id = true;
  IF pol IS NULL OR pol.enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  -- No risk percentage means benchmark execution is UNAVAILABLE, not defaulted.
  IF pol.risk_percent IS NULL THEN
    RETURN NEW;
  END IF;
  IF pol.benchmark_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  grade_rank := CASE NEW.grade WHEN 'A+' THEN 3 WHEN 'A' THEN 2 WHEN 'B' THEN 1 ELSE 0 END;
  min_rank := CASE pol.min_grade WHEN 'A+' THEN 3 WHEN 'A' THEN 2 ELSE 1 END;
  IF grade_rank < min_rank OR grade_rank = 0 THEN
    RETURN NEW;
  END IF;

  IF array_length(pol.instruments, 1) IS NOT NULL
     AND NOT (NEW.instrument = ANY (pol.instruments)) THEN
    RETURN NEW;
  END IF;

  IF pol.daily_order_cap IS NOT NULL THEN
    SELECT count(*) INTO used_today
      FROM public.execution_deliveries d
     WHERE d.connected_account_id = pol.benchmark_account_id
       AND d.bridge_profile LIKE 'benchmark:%'
       AND d.enqueued_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
    IF used_today >= pol.daily_order_cap THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.execution_deliveries (
    user_id, signal_id, bridge_profile, destination_type, connected_account_id,
    account_mode, dry_run, execution_config_version
  )
  SELECT a.user_id,
         NEW.id,
         'benchmark:' || a.id::text,
         'metaapi_direct',
         a.id,
         a.mode,
         pol.dry_run,
         pol.policy_version
    FROM public.connected_trading_accounts a
   WHERE a.id = pol.benchmark_account_id
     AND a.is_benchmark = true
     AND a.disconnected_at IS NULL
     AND a.phase IN ('connected', 'ready')
     AND a.intent_conflict = false
     AND a.trade_allowed = true
     AND COALESCE(a.investor_mode, false) = false
     AND a.broker_account_type = 'demo'
     AND a.mode = 'demo_auto'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_execution_deliveries() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_evidence_phase_lock() FROM PUBLIC, anon, authenticated;