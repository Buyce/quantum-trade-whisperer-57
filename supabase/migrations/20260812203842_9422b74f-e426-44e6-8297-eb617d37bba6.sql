-- 1. Allow volatility_index to be NULL so corrupted historical values can be cleared.
ALTER TABLE public.market_context ALTER COLUMN volatility_index DROP NOT NULL;
ALTER TABLE public.market_context ALTER COLUMN volatility_index DROP DEFAULT;

-- 2. Queue maintenance: reclaim zombie jobs + prune telemetry.
CREATE OR REPLACE FUNCTION public.maintain_scan_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reclaimed integer := 0;
  pruned integer := 0;
BEGIN
  -- A job left in 'processing' past its lease means the worker died mid-run.
  -- Fail it explicitly so it can never wedge the queue; the next 15-minute
  -- cycle enqueues a fresh job for that instrument.
  WITH stale AS (
    UPDATE public.scan_queue
       SET status = 'failed',
           result = 'failed',
           error = coalesce(error, 'Worker lease expired: job abandoned in processing'),
           processed_at = now(),
           finished_at = now()
     WHERE status = 'processing'
       AND started_at < now() - interval '5 minutes'
    RETURNING id
  )
  SELECT count(*) INTO reclaimed FROM stale;

  -- scan_queue is pure telemetry; keep a 7-day window.
  WITH old AS (
    DELETE FROM public.scan_queue
     WHERE enqueued_at < now() - interval '7 days'
    RETURNING id
  )
  SELECT count(*) INTO pruned FROM old;

  RETURN jsonb_build_object('reclaimed', reclaimed, 'pruned', pruned);
END;
$$;

REVOKE ALL ON FUNCTION public.maintain_scan_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.maintain_scan_queue() FROM anon;
REVOKE ALL ON FUNCTION public.maintain_scan_queue() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.maintain_scan_queue() TO service_role;

-- 3. Run maintenance every 15 minutes, a minute before the scan cycle.
SELECT cron.schedule(
  'maintain-scan-queue',
  '14,29,44,59 * * * *',
  $$SELECT public.maintain_scan_queue()$$
);