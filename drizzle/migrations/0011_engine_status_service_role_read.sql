-- Let the scanner's starvation watch read the engine numbers it already needs.
--
-- The watch runs from the pg_cron scan cycle with the server-only service-role
-- client. That client carries no user email, so `is_admin()` (an email check on
-- the JWT) is always false for it, and `get_admin_engine_status()` raised
-- 'forbidden' on every cycle. The watch therefore reported
-- `{ checked: false, reason: "forbidden" }` and could never open or clear a
-- starvation incident - the exact safety net built for the seven-hour outage.
--
-- Fix: split the aggregation out of the admin gate instead of duplicating it.
-- `build_engine_status()` holds the one copy of the numbers; the browser-facing
-- `get_admin_engine_status()` keeps its admin check and returns that same
-- aggregate. `build_engine_status()` is executable by service_role only, so no
-- browser role gains access to anything it did not already have.

create or replace function public.build_engine_status()
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

-- Server-only: the service-role client is the sole caller. No browser role may
-- execute it, so the admin gate on get_admin_engine_status() stays the only way
-- a signed-in session can reach these numbers.
revoke execute on function public.build_engine_status() from public, anon, authenticated;
grant execute on function public.build_engine_status() to service_role;

-- The admin-facing wrapper keeps its gate and now returns the shared aggregate.
create or replace function public.get_admin_engine_status()
returns jsonb
language plpgsql
stable security definer
set search_path = public
set statement_timeout to '3000ms'
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return public.build_engine_status();
end;
$$;
