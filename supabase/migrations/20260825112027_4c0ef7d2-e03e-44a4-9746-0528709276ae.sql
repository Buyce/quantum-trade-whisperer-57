ALTER VIEW public.instrument_spread_samples_valid SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION public.get_admin_instrument_diagnostics() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_instrument_diagnostics() TO service_role;