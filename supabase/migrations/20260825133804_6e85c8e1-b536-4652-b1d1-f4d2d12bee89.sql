REVOKE EXECUTE ON FUNCTION public.set_execution_control(text, jsonb, text, text, jsonb, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_commissioning() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_engine_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_reset_shadow_breaker() FROM anon;
REVOKE EXECUTE ON FUNCTION public.bump_execution_config_version() FROM anon, authenticated;