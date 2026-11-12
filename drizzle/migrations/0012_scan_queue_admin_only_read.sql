DROP POLICY IF EXISTS "queue_readable_by_authenticated" ON public.scan_queue;
CREATE POLICY "queue_readable_by_admin" ON public.scan_queue FOR SELECT TO authenticated USING (public.is_admin());