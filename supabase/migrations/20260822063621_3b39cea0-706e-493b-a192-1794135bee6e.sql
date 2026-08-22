revoke execute on function public.claim_spec_refresh(text, integer) from anon, authenticated, public;
revoke execute on function public.record_spec_refresh_outcome(text, text, text) from anon, authenticated, public;
grant execute on function public.claim_spec_refresh(text, integer) to service_role;
grant execute on function public.record_spec_refresh_outcome(text, text, text) to service_role;