REVOKE ALL ON FUNCTION public.sample_worker_call_health() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_starvation_incident(integer, integer, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_starvation_notified(bigint) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_starvation_incident() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_worker_call_health() TO postgres;
GRANT EXECUTE ON FUNCTION public.claim_starvation_incident(integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_starvation_notified(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_starvation_incident() TO service_role;