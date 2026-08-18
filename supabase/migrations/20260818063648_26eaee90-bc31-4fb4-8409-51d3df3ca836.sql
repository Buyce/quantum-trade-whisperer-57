REVOKE ALL ON FUNCTION public.claim_shadow_job() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.maintain_shadow_queue() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.enroll_shadow_signal() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.claim_shadow_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.maintain_shadow_queue() TO service_role;