-- Prompt 13 final closure: config-version binding + opt-in exposure limit

-- 1. Monotonic execution configuration version on scanner_settings.
ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS execution_config_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS exposure_limit_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.scanner_settings.execution_config_version IS
  'Monotonic, non-secret version of the configuration that authorizes execution. Bumped whenever endpoint, format, secret identity, dry/live authorization or quantity-determining risk inputs change. Snapshotted onto execution_deliveries at enqueue.';
COMMENT ON COLUMN public.scanner_settings.exposure_limit_enabled IS
  'Explicit opt-in: block automated execution when exposure derived SOLELY from trades the user logged exceeds the limits. Advisory-only when false.';

CREATE OR REPLACE FUNCTION public.bump_execution_config_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.webhook_url IS DISTINCT FROM OLD.webhook_url
     OR NEW.webhook_format IS DISTINCT FROM OLD.webhook_format
     OR md5(COALESCE(NEW.webhook_secret, '')) IS DISTINCT FROM md5(COALESCE(OLD.webhook_secret, ''))
     OR NEW.webhook_enabled IS DISTINCT FROM OLD.webhook_enabled
     OR NEW.execution_enabled IS DISTINCT FROM OLD.execution_enabled
     OR NEW.execution_dry_run IS DISTINCT FROM OLD.execution_dry_run
     OR NEW.order_strategy IS DISTINCT FROM OLD.order_strategy
     OR NEW.exposure_limit_enabled IS DISTINCT FROM OLD.exposure_limit_enabled
     OR NEW.account_equity IS DISTINCT FROM OLD.account_equity
     OR NEW.account_currency IS DISTINCT FROM OLD.account_currency
     OR NEW.risk_per_trade_percent IS DISTINCT FROM OLD.risk_per_trade_percent
     OR NEW.max_position_size IS DISTINCT FROM OLD.max_position_size
     OR NEW.leverage IS DISTINCT FROM OLD.leverage
     OR NEW.max_stop_loss_percent IS DISTINCT FROM OLD.max_stop_loss_percent
  THEN
    NEW.execution_config_version := COALESCE(OLD.execution_config_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_execution_config_version_trg ON public.scanner_settings;
CREATE TRIGGER bump_execution_config_version_trg
BEFORE UPDATE ON public.scanner_settings
FOR EACH ROW EXECUTE FUNCTION public.bump_execution_config_version();

-- 2. Snapshot the authorizing configuration version onto the delivery.
ALTER TABLE public.execution_deliveries
  ADD COLUMN IF NOT EXISTS execution_config_version integer;

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

  INSERT INTO public.execution_deliveries (user_id, signal_id, dry_run, execution_config_version)
  SELECT s.user_id, NEW.id, COALESCE(s.execution_dry_run, true), s.execution_config_version
    FROM public.scanner_settings s
   WHERE s.execution_enabled = true
     AND s.webhook_enabled = true
     AND s.webhook_url IS NOT NULL
  ON CONFLICT (user_id, signal_id, bridge_profile) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 3. Claim RPC must return the snapshot so dispatch can compare it.
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
  execution_config_version integer
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
            d.enqueued_at, d.execution_config_version;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_execution_delivery(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_execution_delivery(integer) TO service_role;