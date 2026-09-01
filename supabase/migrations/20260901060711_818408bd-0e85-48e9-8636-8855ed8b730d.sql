CREATE OR REPLACE FUNCTION public.purge_expired_signals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  total_deleted integer;
BEGIN
  WITH to_purge AS (
    SELECT s.*
      FROM public.scanned_signals s
     WHERE s.status = 'expired'
       AND (
         (s.grade = 'C' AND s.detected_at < now() - interval '24 hours')
         OR (s.grade = 'B' AND s.detected_at < now() - interval '36 hours')
         OR (s.grade IN ('A', 'A+') AND s.detected_at < now() - interval '48 hours')
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.executed_trades t
          WHERE t.signal_id = s.id
            AND t.user_decision = 'taken'
       )
       AND EXISTS (
         SELECT 1
           FROM public.shadow_executions se
          WHERE se.signal_id = s.id
       )
       -- A delivery that ever reached a broker is permanent evidence: without it
       -- a filled, closed broker trade can never be associated back to P-Trades.
       AND NOT EXISTS (
         SELECT 1
           FROM public.execution_deliveries d
          WHERE d.signal_id = s.id
            AND (
              d.state IN ('pending', 'claimed', 'sent', 'unknown', 'acknowledged')
              OR d.client_id IS NOT NULL
              OR d.submitted_at IS NOT NULL
              OR d.broker_order_id IS NOT NULL
            )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.broker_trade_evidence e
          WHERE e.signal_id = s.id
       )
  ),
  archived AS (
    INSERT INTO public.signal_retention_archive (
      signal_id,
      signal_snapshot,
      market_context_snapshot,
      shadow_execution_id,
      model_version
    )
    SELECT p.id,
           to_jsonb(p),
           (
             SELECT to_jsonb(mc)
               FROM public.market_context mc
              WHERE mc.signal_id = p.id
              LIMIT 1
           ),
           (
             SELECT se.id
               FROM public.shadow_executions se
              WHERE se.signal_id = p.id
              LIMIT 1
           ),
           p.model_version
      FROM to_purge p
    ON CONFLICT (signal_id) DO NOTHING
    RETURNING signal_id
  ),
  archive_ready AS (
    SELECT signal_id FROM archived
    UNION
    SELECT p.id
      FROM to_purge p
      JOIN public.signal_retention_archive a ON a.signal_id = p.id
  ),
  deleted_signals AS (
    DELETE FROM public.scanned_signals s
     WHERE s.id IN (SELECT signal_id FROM archive_ready)
    RETURNING s.id
  )
  SELECT count(*) INTO total_deleted FROM deleted_signals;

  RETURN total_deleted;
END;
$fn$;