ALTER TABLE public.execution_deliveries
  ADD COLUMN IF NOT EXISTS final_look_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_look_reason text;

COMMENT ON COLUMN public.execution_deliveries.final_look_at IS
  'When the last, forced-fresh re-check inside the closing tail of the owner automatic-order window was performed.';
COMMENT ON COLUMN public.execution_deliveries.final_look_reason IS
  'Outcome of that final look. Null means it was approved or never needed.';

ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS maximum_daily_orders_per_symbol integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS adaptive_order_ceilings_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS adaptive_order_ceiling_max integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS adaptive_order_ceiling_floor integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scanner_settings_per_symbol_ceiling_range'
  ) THEN
    ALTER TABLE public.scanner_settings
      ADD CONSTRAINT scanner_settings_per_symbol_ceiling_range
      CHECK (maximum_daily_orders_per_symbol BETWEEN 0 AND 25);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scanner_settings_adaptive_ceiling_range'
  ) THEN
    ALTER TABLE public.scanner_settings
      ADD CONSTRAINT scanner_settings_adaptive_ceiling_range
      CHECK (
        adaptive_order_ceiling_max BETWEEN 0 AND 25
        AND adaptive_order_ceiling_floor BETWEEN 0 AND 25
      );
  END IF;
END $$;

COMMENT ON COLUMN public.scanner_settings.maximum_daily_orders_per_symbol IS
  'How many automatic orders one instrument may consume per UTC day (0-25). Default 25 is a no-op against the daily ceiling.';
COMMENT ON COLUMN public.scanner_settings.adaptive_order_ceilings_enabled IS
  'Owner opt-in: move the effective daily and per-symbol ceilings with broker data freshness. Off by default.';
COMMENT ON COLUMN public.scanner_settings.adaptive_order_ceiling_max IS
  'Upper bound adaptive mode may raise a ceiling to when broker freshness is healthy (0-25).';
COMMENT ON COLUMN public.scanner_settings.adaptive_order_ceiling_floor IS
  'Lower bound adaptive mode reduces a ceiling to when broker freshness is degraded or unknown (0-25).';

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
       LEFT JOIN public.scanned_signals s ON s.id = d2.signal_id
       LEFT JOIN public.scanner_settings st ON st.user_id = d2.user_id
      WHERE d2.state = 'pending'
      ORDER BY
        (s.detected_at + make_interval(mins => COALESCE(st.auto_order_window_minutes, 180)))
          ASC NULLS LAST,
        d2.enqueued_at
      FOR UPDATE OF d2 SKIP LOCKED
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