REVOKE ALL ON FUNCTION public.walk_forward_confirmed(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.walk_forward_confirmed(text) TO service_role;