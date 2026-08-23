REVOKE ALL ON FUNCTION public.guard_benchmark_flag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_benchmark_flag() FROM anon;
REVOKE ALL ON FUNCTION public.guard_benchmark_flag() FROM authenticated;
REVOKE ALL ON FUNCTION public.enqueue_execution_deliveries() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_execution_deliveries() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_execution_deliveries() FROM authenticated;