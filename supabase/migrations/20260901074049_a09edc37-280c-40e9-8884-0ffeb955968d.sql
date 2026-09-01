ALTER TABLE public.execution_deliveries
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

COMMENT ON COLUMN public.execution_deliveries.next_attempt_at IS
  'Earliest instant this delivery may be claimed again. Set when a momentary refusal returns the row to pending, so the same question is not re-asked before its answer could change. NULL means claimable now.';

CREATE INDEX IF NOT EXISTS execution_deliveries_pending_next_attempt_idx
  ON public.execution_deliveries (next_attempt_at, attempts, enqueued_at)
  WHERE state = 'pending';

CREATE OR REPLACE FUNCTION public.claim_execution_delivery(lease_seconds integer DEFAULT 60)
 RETURNS TABLE(id bigint, user_id uuid, signal_id uuid, bridge_profile text, dry_run boolean, attempts integer, enqueued_at timestamp with time zone, execution_config_version integer, destination_type text, connected_account_id uuid, account_mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.execution_deliveries d
     SET state = 'claimed',
         attempts = d.attempts + 1,
         claimed_at = now(),
         next_attempt_at = NULL,
         lease_expires_at = now() + make_interval(secs => lease_seconds)
   WHERE d.id = (
     SELECT d2.id
       FROM public.execution_deliveries d2
       LEFT JOIN public.scanned_signals s ON s.id = d2.signal_id
       LEFT JOIN public.scanner_settings st ON st.user_id = d2.user_id
      WHERE d2.state = 'pending'
        -- A row refused for a momentary reason waits out its backoff. Rows that
        -- have never been refused have no schedule and are claimable at once.
        AND (d2.next_attempt_at IS NULL OR d2.next_attempt_at <= now())
      ORDER BY
        (s.detected_at + make_interval(mins => COALESCE(st.auto_order_window_minutes, 180)))
          ASC NULLS LAST,
        -- Fairness: among rows with the same deadline, the least-tried row goes
        -- first, so a repeatedly-refused row cannot monopolise the worker.
        d2.attempts ASC,
        d2.enqueued_at
      FOR UPDATE OF d2 SKIP LOCKED
      LIMIT 1
   )
  RETURNING d.id, d.user_id, d.signal_id, d.bridge_profile, d.dry_run, d.attempts,
            d.enqueued_at, d.execution_config_version, d.destination_type,
            d.connected_account_id, d.account_mode;
END;
$function$;