-- ============================================================
-- Prompt 13: execution control plane
-- Live execution is GLOBALLY DISABLED by default and dry-run by default.
-- ============================================================

-- 1. Global execution controls (singleton, separate from the research engine)
CREATE TABLE IF NOT EXISTS public.execution_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  live_execution_enabled boolean NOT NULL DEFAULT false,
  force_dry_run boolean NOT NULL DEFAULT true,
  disabled_bridges text[] NOT NULL DEFAULT '{}',
  disabled_instruments text[] NOT NULL DEFAULT '{}',
  execution_policy text NOT NULL DEFAULT 'single_exit_first_target',
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.execution_controls TO service_role;
ALTER TABLE public.execution_controls ENABLE ROW LEVEL SECURITY;
INSERT INTO public.execution_controls (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 2. Per-user execution opt-in
ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS execution_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS execution_dry_run boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS webhook_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_validation_reason text;

-- 3. Durable delivery ledger. One row per (user, signal, bridge profile).
CREATE TABLE IF NOT EXISTS public.execution_deliveries (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id uuid NOT NULL REFERENCES public.scanned_signals(id) ON DELETE CASCADE,
  bridge_profile text NOT NULL DEFAULT 'primary',
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','claimed','sent','acknowledged','rejected','unknown','failed')),
  dry_run boolean NOT NULL DEFAULT true,
  execution_policy text NOT NULL DEFAULT 'single_exit_first_target',
  payload_version integer NOT NULL DEFAULT 2,
  attempts integer NOT NULL DEFAULT 0,
  reason text,
  endpoint_host text,
  request_fingerprint text,
  http_status integer,
  latency_ms integer,
  broker_order_id text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  settled_at timestamptz,
  CONSTRAINT execution_deliveries_unique UNIQUE (user_id, signal_id, bridge_profile)
);

CREATE INDEX IF NOT EXISTS execution_deliveries_pending_idx
  ON public.execution_deliveries (enqueued_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS execution_deliveries_lease_idx
  ON public.execution_deliveries (lease_expires_at) WHERE state = 'claimed';

GRANT SELECT ON public.execution_deliveries TO authenticated;
GRANT ALL ON public.execution_deliveries TO service_role;
ALTER TABLE public.execution_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their own deliveries"
  ON public.execution_deliveries FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 4. Enqueue on publication. A plain INSERT: it can never influence the
--    publish outcome, and it makes duplicate publishes converge on one row.
CREATE OR REPLACE FUNCTION public.enqueue_execution_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.grade = 'C' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.execution_deliveries (user_id, signal_id, dry_run)
  SELECT s.user_id, NEW.id, COALESCE(s.execution_dry_run, true)
    FROM public.scanner_settings s
   WHERE s.execution_enabled = true
     AND s.webhook_enabled = true
     AND s.webhook_url IS NOT NULL
  ON CONFLICT (user_id, signal_id, bridge_profile) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_execution_deliveries_trg ON public.scanned_signals;
CREATE TRIGGER enqueue_execution_deliveries_trg
AFTER INSERT ON public.scanned_signals
FOR EACH ROW EXECUTE FUNCTION public.enqueue_execution_deliveries();

-- 5. Claim RPC. Only `pending` is ever claimable: a `sent` or `unknown` row is
--    never re-attempted, because a duplicate POST could double-fire an order.
CREATE OR REPLACE FUNCTION public.claim_execution_delivery(lease_seconds integer DEFAULT 60)
RETURNS TABLE(
  id bigint,
  user_id uuid,
  signal_id uuid,
  bridge_profile text,
  dry_run boolean,
  attempts integer,
  enqueued_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.execution_deliveries d
     SET state = 'claimed',
         attempts = d.attempts + 1,
         claimed_at = now(),
         lease_expires_at = now() + make_interval(secs => lease_seconds)
   WHERE d.id = (
     SELECT d2.id
       FROM public.execution_deliveries d2
      WHERE d2.state = 'pending'
      ORDER BY d2.enqueued_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING d.id, d.user_id, d.signal_id, d.bridge_profile, d.dry_run, d.attempts, d.enqueued_at;
END;
$$;

-- 6. Lease expiry fails CLOSED: an abandoned claim becomes `unknown`, never
--    `pending`, so no worker crash can turn into a second order.
CREATE OR REPLACE FUNCTION public.expire_execution_leases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.execution_deliveries
     SET state = 'unknown',
         reason = COALESCE(reason, 'lease_expired_no_acknowledgement'),
         settled_at = now()
   WHERE state = 'claimed'
     AND lease_expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_execution_delivery(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_execution_leases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_execution_delivery(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_execution_leases() TO service_role;