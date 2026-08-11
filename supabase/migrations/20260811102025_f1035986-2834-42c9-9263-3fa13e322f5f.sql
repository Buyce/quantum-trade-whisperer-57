CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.scanned_signals ADD COLUMN IF NOT EXISTS expired_at timestamp with time zone;

UPDATE public.scanned_signals
SET expired_at = detected_at + INTERVAL '24 hours'
WHERE status = 'expired' AND expired_at IS NULL;

CREATE OR REPLACE FUNCTION public.purge_expired_signals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  total_deleted integer;
BEGIN
  WITH to_purge AS (
    SELECT s.id
    FROM public.scanned_signals s
    WHERE s.status = 'expired'
      AND (
        (s.grade = 'C' AND s.detected_at < NOW() - INTERVAL '24 hours')
        OR (s.grade = 'B' AND s.detected_at < NOW() - INTERVAL '36 hours')
        OR (s.grade IN ('A', 'A+') AND s.detected_at < NOW() - INTERVAL '48 hours')
      )
      AND NOT EXISTS (SELECT 1 FROM public.executed_trades t WHERE t.signal_id = s.id)
  ),
  deleted_context AS (
    DELETE FROM public.market_context
    WHERE signal_id IN (SELECT id FROM to_purge)
    RETURNING signal_id
  ),
  deleted_signals AS (
    DELETE FROM public.scanned_signals
    WHERE id IN (SELECT id FROM to_purge)
    RETURNING id
  )
  SELECT COUNT(*) INTO total_deleted FROM deleted_signals;

  RETURN total_deleted;
END;
$$;

SELECT cron.schedule('purge-expired-signals', '0 * * * *', 'SELECT public.purge_expired_signals()');