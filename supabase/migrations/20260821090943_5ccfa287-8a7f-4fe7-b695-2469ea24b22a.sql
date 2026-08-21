REVOKE ALL ON FUNCTION public.claim_v2_structure(smallint, text, integer) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.prune_v2_structure_claims() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_v2_structure(smallint, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_v2_structure_claims() TO service_role;