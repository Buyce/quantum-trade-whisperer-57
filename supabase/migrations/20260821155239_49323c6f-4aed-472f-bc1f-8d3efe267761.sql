REVOKE ALL ON FUNCTION public.get_admin_filter_lift() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_filter_lift() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_filter_lift() TO authenticated, service_role;