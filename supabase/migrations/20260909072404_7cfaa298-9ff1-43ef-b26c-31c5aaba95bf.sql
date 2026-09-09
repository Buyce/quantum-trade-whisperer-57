REVOKE ALL ON FUNCTION public.get_admin_market_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_market_context() FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_market_context() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_market_context() TO service_role;