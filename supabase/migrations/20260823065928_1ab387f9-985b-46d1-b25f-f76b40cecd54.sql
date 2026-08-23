ALTER TABLE public.execution_controls
  ADD COLUMN IF NOT EXISTS demo_auto_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_confirm_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_auto_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.execution_deliveries
  ADD COLUMN IF NOT EXISTS destination_type text NOT NULL DEFAULT 'bridge_json',
  ADD COLUMN IF NOT EXISTS connected_account_id uuid
    REFERENCES public.connected_trading_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_mode text,
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS magic integer,
  ADD COLUMN IF NOT EXISTS broker_symbol text,
  ADD COLUMN IF NOT EXISTS submitted_volume numeric,
  ADD COLUMN IF NOT EXISTS submitted_entry numeric,
  ADD COLUMN IF NOT EXISTS submitted_stop numeric,
  ADD COLUMN IF NOT EXISTS submitted_target numeric,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS margin_estimate numeric,
  ADD COLUMN IF NOT EXISTS margin_currency text,
  ADD COLUMN IF NOT EXISTS broker_position_id text,
  ADD COLUMN IF NOT EXISTS broker_retcode integer,
  ADD COLUMN IF NOT EXISTS broker_retcode_string text;

ALTER TABLE public.execution_deliveries
  DROP CONSTRAINT IF EXISTS execution_deliveries_destination_type_check;
ALTER TABLE public.execution_deliveries
  ADD CONSTRAINT execution_deliveries_destination_type_check
  CHECK (destination_type IN ('bridge_json','metaapi_direct'));

ALTER TABLE public.execution_deliveries
  DROP CONSTRAINT IF EXISTS execution_deliveries_account_mode_check;
ALTER TABLE public.execution_deliveries
  ADD CONSTRAINT execution_deliveries_account_mode_check
  CHECK (account_mode IS NULL OR account_mode IN ('observe','demo_auto','live_confirm','live_auto'));

ALTER TABLE public.execution_deliveries
  DROP CONSTRAINT IF EXISTS execution_deliveries_destination_account_check;
ALTER TABLE public.execution_deliveries
  ADD CONSTRAINT execution_deliveries_destination_account_check
  CHECK (
    (destination_type = 'metaapi_direct' AND connected_account_id IS NOT NULL)
    OR (destination_type = 'bridge_json' AND connected_account_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS execution_deliveries_direct_once
  ON public.execution_deliveries (connected_account_id, signal_id)
  WHERE destination_type = 'metaapi_direct';

CREATE OR REPLACE FUNCTION public.enqueue_execution_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  demo_auto boolean;
  live_auto boolean;
BEGIN
  IF NEW.grade = 'C' THEN
    RETURN NEW;
  END IF;

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
       AND a.phase IN ('connected','ready')
       AND a.intent_conflict = false
       AND a.trade_allowed = true
       AND COALESCE(a.investor_mode, false) = false
       AND (
         (a.mode = 'demo_auto' AND a.broker_account_type = 'demo' AND COALESCE(demo_auto, false))
         OR (a.mode = 'live_auto' AND a.broker_account_type = 'real' AND COALESCE(live_auto, false))
       )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.claim_execution_delivery(integer);

CREATE OR REPLACE FUNCTION public.claim_execution_delivery(lease_seconds integer DEFAULT 60)
RETURNS TABLE(
  id bigint,
  user_id uuid,
  signal_id uuid,
  bridge_profile text,
  dry_run boolean,
  attempts integer,
  enqueued_at timestamptz,
  execution_config_version integer,
  destination_type text,
  connected_account_id uuid,
  account_mode text
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
  RETURNING d.id, d.user_id, d.signal_id, d.bridge_profile, d.dry_run, d.attempts,
            d.enqueued_at, d.execution_config_version, d.destination_type,
            d.connected_account_id, d.account_mode;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_execution_delivery(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_execution_delivery(integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_execution_delivery(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_execution_delivery(integer) TO service_role;