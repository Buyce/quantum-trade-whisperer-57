REVOKE ALL ON FUNCTION public.recompute_regime_stats(smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_scan_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_regime_stats(smallint) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_scan_job() TO service_role;