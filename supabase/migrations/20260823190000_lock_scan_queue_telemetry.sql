-- Release-audit closure: scan_queue is operational telemetry, not customer data.
-- Scanner health is exposed through deliberately projected server/RPC surfaces;
-- ordinary authenticated users must not read raw job errors, run ids or timing.
DROP POLICY IF EXISTS "queue_readable_by_authenticated" ON public.scan_queue;
REVOKE SELECT ON TABLE public.scan_queue FROM authenticated;

