REVOKE EXECUTE ON FUNCTION public.purge_expired_signals() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_expired_signals() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_signals() TO service_role;