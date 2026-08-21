REVOKE ALL ON FUNCTION public.get_admin_author_split() FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_author_split() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_author_split() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_author_split() TO service_role;