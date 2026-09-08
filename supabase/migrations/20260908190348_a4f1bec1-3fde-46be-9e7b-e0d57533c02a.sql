-- Scan worker throughput fix: single-flight lease, faster abandonment recovery,
-- expired-claim-aware drain guards, caller headroom, and honest link-health causes.
-- cron jobs referenced by literal id (queried from cron.job beforehand).

create table if not exists public.scan_worker_lease (
  id boolean primary key default true check (id),
  holder text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

grant all on public.scan_worker_lease to service_role;

create or replace function public.try_acquire_scan_worker_lease(
  p_holder text,
  p_ttl_seconds integer default 90
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acquired integer;
begin
  delete from public.scan_worker_lease where expires_at < now();
  insert into public.scan_worker_lease (id, holder, expires_at)
  values (true, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (id) do nothing;
  get diagnostics v_acquired = row_count;
  return v_acquired > 0;
end;
$$;

create or replace function public.release_scan_worker_lease(p_holder text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.scan_worker_lease where holder = p_holder;
$$;

grant execute on function public.try_acquire_scan_worker_lease(text, integer) to service_role;
grant execute on function public.release_scan_worker_lease(text) to service_role;

create table if not exists public.market_data_slots (
  id bigint generated always as identity primary key,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

grant all on public.market_data_slots to service_role;

create or replace function public.acquire_market_data_slot(p_ttl_seconds integer default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_id bigint;
begin
  delete from public.market_data_slots where expires_at < now();
  select count(*) into v_count from public.market_data_slots;
  if v_count >= 5 then
    return null;
  end if;
  insert into public.market_data_slots (expires_at)
  values (now() + make_interval(secs => p_ttl_seconds))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.release_market_data_slot(p_slot_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.market_data_slots where id = p_slot_id;
$$;

grant execute on function public.acquire_market_data_slot(integer) to service_role;
grant execute on function public.release_market_data_slot(bigint) to service_role;

create or replace function public.maintain_scan_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reclaimed integer := 0;
  pruned integer := 0;
  webhook_pruned integer := 0;
begin
  with stale as (
    update public.scan_queue
       set status = case when attempts >= 3 then 'failed' else 'pending' end,
           result = case when attempts >= 3 then 'failed' else null end,
           error = 'Worker lease expired: job returned to the queue',
           started_at = null,
           processed_at = case when attempts >= 3 then now() else null end,
           finished_at = case when attempts >= 3 then now() else null end
     where status = 'processing'
       and started_at < now() - interval '2 minutes'
    returning id
  )
  select count(*) into reclaimed from stale;

  with old as (
    delete from public.scan_queue
     where enqueued_at < now() - interval '7 days'
    returning id
  )
  select count(*) into pruned from old;

  with oldhooks as (
    delete from public.webhook_dispatch_log
     where created_at < now() - interval '14 days'
    returning id
  )
  select count(*) into webhook_pruned from oldhooks;

  return jsonb_build_object(
    'reclaimed', reclaimed,
    'pruned', pruned,
    'webhook_pruned', webhook_pruned
  );
end;
$$;

-- Job 5: maintain-scan-queue -> every minute.
select cron.alter_job(5, schedule := '* * * * *');

-- Job 7: scan-worker-drain -> fire on pending work OR an expired claim; 30s patience.
select cron.alter_job(
  7,
  command := $$
    SELECT net.http_post(
      url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/worker/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
      ),
      body := jsonb_build_object('source', 'pg_cron_drain'),
      timeout_milliseconds := 30000
    )
    WHERE EXISTS (SELECT 1 FROM public.scan_queue WHERE status = 'pending')
       OR EXISTS (SELECT 1 FROM public.scan_queue
                   WHERE status = 'processing'
                     AND started_at < now() - interval '2 minutes');
  $$
);

-- Job 23: scan-worker-drain-offset -> same guard, 30s offset, 30s patience.
select cron.alter_job(
  23,
  command := $$
    SELECT pg_sleep(30);
    SELECT net.http_post(
      url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/worker/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
      ),
      body := jsonb_build_object('source', 'pg_cron_drain_offset'),
      timeout_milliseconds := 30000
    )
    WHERE EXISTS (SELECT 1 FROM public.scan_queue WHERE status = 'pending')
       OR EXISTS (SELECT 1 FROM public.scan_queue
                   WHERE status = 'processing'
                     AND started_at < now() - interval '2 minutes');
  $$
);

-- Job 1: ptrades-scan-cycle -> 10s headroom.
select cron.alter_job(
  1,
  command := $$
    select net.http_post(
      url := (select worker_base_url from private.scanner_config where id) || '/api/public/cron/scan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select cron_secret from private.scanner_config where id)
      ),
      body := '{"source":"pg_cron"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $$
);

-- 20s -> 30s headroom for dispatch/reconcile/refresh.
select cron.alter_job(11, command := $$
  SELECT net.http_post(
    url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/worker/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 30000
  );
$$);
select cron.alter_job(15, command := $$
  SELECT net.http_post(
    url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/worker/reconcile-active',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 30000
  );
$$);
select cron.alter_job(16, command := $$
  SELECT net.http_post(
    url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/worker/reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 30000
  );
$$);
select cron.alter_job(17, command := $$
  SELECT net.http_post(
    url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/cron/refresh-accounts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 30000
  );
$$);

alter table public.worker_call_health
  add column if not exists failed_5xx integer not null default 0,
  add column if not exists scanner_ok integer not null default 0,
  add column if not exists scanner_failed integer not null default 0;

create or replace function public.sample_worker_call_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok integer := 0;
  v_failed integer := 0;
  v_timeout integer := 0;
  v_dns integer := 0;
  v_5xx integer := 0;
  v_scanner_ok integer := 0;
  v_scanner_failed integer := 0;
  v_last_at timestamptz;
  v_detail text;
begin
  select
    count(*) filter (where status_code between 200 and 299),
    count(*) filter (where status_code is null or status_code < 200 or status_code > 299),
    count(*) filter (
      where (status_code is null or status_code < 200 or status_code > 299)
        and error_msg ilike '%Timeout of%'
        and coalesce((substring(error_msg from 'DNS time: ([0-9.]+) ms'))::numeric, 0)
            < 0.9 * coalesce((substring(error_msg from 'Timeout of ([0-9]+) ms'))::numeric, 0)
    ),
    count(*) filter (
      where (status_code is null or status_code < 200 or status_code > 299)
        and error_msg ilike '%Timeout of%'
        and substring(error_msg from 'Timeout of ([0-9]+) ms') is not null
        and coalesce((substring(error_msg from 'DNS time: ([0-9.]+) ms'))::numeric, 0)
            >= 0.9 * (substring(error_msg from 'Timeout of ([0-9]+) ms'))::numeric
    ),
    count(*) filter (where status_code >= 500),
    max(created) filter (where status_code is null or status_code < 200 or status_code > 299)
  into v_ok, v_failed, v_timeout, v_dns, v_5xx, v_last_at
  from net._http_response
  where created > now() - interval '5 minutes';

  select
    count(*) filter (where d.status = 'succeeded'),
    count(*) filter (where d.status = 'failed')
  into v_scanner_ok, v_scanner_failed
  from cron.job_run_details d
  join cron.job j on j.command = d.command
  where d.start_time > now() - interval '5 minutes'
    and j.jobname in ('ptrades-scan-cycle', 'scan-worker-drain', 'scan-worker-drain-offset');

  select left(coalesce(r.error_msg, r.content), 300)
    into v_detail
    from net._http_response r
   where r.created > now() - interval '5 minutes'
     and (r.status_code is null or status_code < 200 or status_code > 299)
   order by r.created desc
   limit 1;

  insert into public.worker_call_health (
    window_minutes, ok, failed, failed_timeout, failed_dns, failed_5xx,
    scanner_ok, scanner_failed, last_failure_at, last_failure_detail
  )
  values (
    5, coalesce(v_ok, 0), coalesce(v_failed, 0), coalesce(v_timeout, 0),
    coalesce(v_dns, 0), coalesce(v_5xx, 0),
    coalesce(v_scanner_ok, 0), coalesce(v_scanner_failed, 0),
    v_last_at, v_detail
  );

  delete from public.worker_call_health where sampled_at < now() - interval '7 days';

  return jsonb_build_object(
    'ok', coalesce(v_ok, 0),
    'failed', coalesce(v_failed, 0),
    'failed_timeout', coalesce(v_timeout, 0),
    'failed_dns', coalesce(v_dns, 0),
    'failed_5xx', coalesce(v_5xx, 0),
    'scanner_ok', coalesce(v_scanner_ok, 0),
    'scanner_failed', coalesce(v_scanner_failed, 0)
  );
end;
$$;

create or replace function public.get_admin_engine_status()
returns jsonb
language plpgsql
stable security definer
set search_path = public
set statement_timeout to '3000ms'
as $$
declare
  v_breaker jsonb;
  v_scan jsonb;
  v_link jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select to_jsonb(e) into v_breaker
    from (
      select paused, paused_until, consecutive_failures, last_error, last_run_at
        from shadow_engine_state
       limit 1
    ) e;

  select jsonb_build_object(
    'window_minutes', 60,
    'total', count(*),
    'failed', count(*) filter (where status = 'failed'),
    'succeeded', count(*) filter (where status = 'done'),
    'stale', count(*) filter (where result = 'stale'),
    'analysed', count(*) filter (where result is not null and result <> 'stale'),
    'last_finished_at', max(finished_at),
    'last_success_at', max(finished_at) filter (where status = 'done'),
    'last_failure_at', max(finished_at) filter (where status = 'failed'),
    'last_analysed_at', (select max(finished_at) from scan_queue
                          where result is not null and result <> 'stale'),
    'last_candle_fetch_at', (select max(observed_at) from metaapi_api_observations
                              where surface = 'market-data' and outcome = 'ok'),
    'last_error', (select error from scan_queue
                    where status = 'failed' and error is not null
                      and finished_at > now() - interval '60 minutes'
                    order by finished_at desc limit 1)
  ) into v_scan
    from scan_queue
   where finished_at > now() - interval '60 minutes';

  select jsonb_build_object(
    'window_minutes', 60,
    'ok', coalesce(sum(ok), 0),
    'failed', coalesce(sum(failed), 0),
    'failed_timeout', coalesce(sum(failed_timeout), 0),
    'failed_dns', coalesce(sum(failed_dns), 0),
    'failed_5xx', coalesce(sum(failed_5xx), 0),
    'scanner_ok', coalesce(sum(scanner_ok), 0),
    'scanner_failed', coalesce(sum(scanner_failed), 0),
    'last_failure_at', max(last_failure_at),
    'last_failure_detail', (select last_failure_detail from worker_call_health
                             where last_failure_detail is not null
                             order by sampled_at desc limit 1),
    'last_sampled_at', max(sampled_at)
  ) into v_link
    from worker_call_health
   where sampled_at > now() - interval '60 minutes';

  return jsonb_build_object(
    'generated_at', now(),
    'breaker', coalesce(v_breaker, 'null'::jsonb),
    'scan', v_scan,
    'link', v_link
  );
end;
$$;