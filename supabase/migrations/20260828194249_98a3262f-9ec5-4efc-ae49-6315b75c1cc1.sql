REVOKE ALL ON FUNCTION public.snapshot_broker_order_association()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_broker_order_association() TO service_role;