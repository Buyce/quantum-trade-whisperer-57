REVOKE ALL ON public.baseline_snapshots FROM anon;
REVOKE ALL ON public.baseline_snapshots FROM authenticated;
GRANT ALL ON public.baseline_snapshots TO service_role;