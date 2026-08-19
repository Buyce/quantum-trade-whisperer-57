REVOKE ALL ON FUNCTION public.claim_scan_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scan_job() TO service_role;