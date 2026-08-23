-- Quota lookup is not part of the public API surface: it is consulted by the
-- insert trigger and by the accounts server functions (service role). Client
-- code reads its own quota through the server function, never by RPC.
REVOKE EXECUTE ON FUNCTION public.account_quota(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_account_quota() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_connected_account() FROM PUBLIC, anon, authenticated;