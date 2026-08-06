-- Queue plumbing for the decoupled scanner: per-instrument jobs, atomic claim,
-- and an auto-trigger that kicks the worker chain as soon as jobs land.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.scan_queue
  alter column timeframe drop not null,
  add column if not exists run_id uuid,
  add column if not exists result text,
  add column if not exists processed_at timestamptz;

create index if not exists scan_queue_pending_idx
  on public.scan_queue (status, enqueued_at)
  where status = 'pending';

-- Private config (worker base URL + shared secret) never exposed via the Data API.
create schema if not exists private;

create table if not exists private.scanner_config (
  id boolean primary key default true check (id),
  worker_base_url text not null,
  cron_secret text not null,
  updated_at timestamptz not null default now()
);

revoke all on private.scanner_config from anon, authenticated;

-- Atomic single-job claim: SKIP LOCKED keeps concurrent workers off each other.
create or replace function public.claim_scan_job()
returns table (id bigint, instrument text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.scan_queue q
     set status = 'processing',
         attempts = q.attempts + 1,
         started_at = now()
   where q.id = (
     select q2.id
       from public.scan_queue q2
      where q2.status = 'pending'
      order by q2.enqueued_at
      for update skip locked
      limit 1
   )
  returning q.id, q.instrument;
end;
$$;

revoke all on function public.claim_scan_job() from public, anon, authenticated;
grant execute on function public.claim_scan_job() to service_role;

-- Auto-kick the worker chain whenever new jobs are enqueued.
create or replace function private.kick_scan_worker()
returns trigger
language plpgsql
security definer
set search_path = private, extensions
as $$
declare
  cfg private.scanner_config;
begin
  select * into cfg from private.scanner_config where id;
  if cfg is null then
    return null;
  end if;

  perform extensions.net_http_post(
    url := cfg.worker_base_url || '/api/public/worker/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cfg.cron_secret
    ),
    body := jsonb_build_object('source', 'scan_queue_trigger'),
    timeout_milliseconds := 4000
  );
  return null;
end;
$$;

revoke all on function private.kick_scan_worker() from public, anon, authenticated;

drop trigger if exists scan_queue_kick_worker on public.scan_queue;
create trigger scan_queue_kick_worker
after insert on public.scan_queue
for each statement
execute function private.kick_scan_worker();