REVOKE EXECUTE ON FUNCTION public.propose_gate_change(text, numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decide_gate_change(uuid, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_learning_evidence() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_filter_lift(integer) FROM anon, authenticated;