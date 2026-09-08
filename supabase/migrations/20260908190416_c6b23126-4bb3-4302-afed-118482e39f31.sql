-- Harden the new worker-coordination objects: internal-only tables and functions.
alter table public.scan_worker_lease enable row level security;
alter table public.market_data_slots enable row level security;

revoke execute on function public.try_acquire_scan_worker_lease(text, integer) from anon, authenticated, public;
revoke execute on function public.release_scan_worker_lease(text) from anon, authenticated, public;
revoke execute on function public.acquire_market_data_slot(integer) from anon, authenticated, public;
revoke execute on function public.release_market_data_slot(bigint) from anon, authenticated, public;