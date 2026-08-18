-- Postgres grants EXECUTE to PUBLIC by default; revoking from anon/authenticated
-- alone leaves that inherited grant in place. These are backend-only latches.
REVOKE ALL ON FUNCTION public.claim_learning_milestone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_learning_milestone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_learning_milestone(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_learning_milestone(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_learning_milestone(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_learning_milestone(text) TO service_role;