-- 1. Truthful record of every scanner pass -----------------------------------
CREATE TABLE IF NOT EXISTS public.worker_pass_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  hop integer NOT NULL DEFAULT 0,
  outcome text NOT NULL,
  drained integer NOT NULL DEFAULT 0,
  duration_ms integer,
  detail text
);

GRANT SELECT ON public.worker_pass_log TO authenticated;
GRANT ALL ON public.worker_pass_log TO service_role;

ALTER TABLE public.worker_pass_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads worker pass log" ON public.worker_pass_log;
CREATE POLICY "Owner reads worker pass log"
  ON public.worker_pass_log FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS worker_pass_log_at_idx ON public.worker_pass_log (at DESC);

-- 2. Lease heartbeat: a live pass keeps its short lock -----------------------
CREATE OR REPLACE FUNCTION public.renew_scan_worker_lease(p_holder text, p_ttl_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_renewed integer := 0;
begin
  update public.scan_worker_lease
     set expires_at = now() + make_interval(secs => greatest(p_ttl_seconds, 5))
   where holder = p_holder;
  get diagnostics v_renewed = row_count;
  return v_renewed > 0;
end;
$function$;

REVOKE ALL ON FUNCTION public.renew_scan_worker_lease(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_scan_worker_lease(text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_scan_worker_lease(text, integer) TO service_role;

-- 3. A cancelled pass must not burn a job's retries --------------------------
CREATE OR REPLACE FUNCTION public.maintain_scan_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  reclaimed integer := 0;
  pruned integer := 0;
  webhook_pruned integer := 0;
  pass_pruned integer := 0;
begin
  -- A lease expiry means the pass was cancelled by the platform, not that the
  -- job is bad: the attempt consumed at claim time is given back. A hard
  -- ceiling of 5 still stops a genuinely poisonous job from cycling forever.
  with stale as (
    update public.scan_queue
       set status = case when attempts >= 5 then 'failed' else 'pending' end,
           result = case when attempts >= 5 then 'failed' else null end,
           attempts = case when attempts >= 5 then attempts else greatest(attempts - 1, 0) end,
           error = 'Worker lease expired: job returned to the queue',
           started_at = null,
           processed_at = case when attempts >= 5 then now() else null end,
           finished_at = case when attempts >= 5 then now() else null end
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

  with oldpasses as (
    delete from public.worker_pass_log
     where at < now() - interval '7 days'
    returning id
  )
  select count(*) into pass_pruned from oldpasses;

  return jsonb_build_object(
    'reclaimed', reclaimed,
    'pruned', pruned,
    'webhook_pruned', webhook_pruned,
    'pass_pruned', pass_pruned
  );
end;
$function$;

-- 4. Scanner call health scored on what the app actually did -----------------
CREATE OR REPLACE FUNCTION public.sample_worker_call_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_ok integer := 0;
  v_failed integer := 0;
  v_timeout integer := 0;
  v_dns integer := 0;
  v_5xx integer := 0;
  v_scanner_ok integer := 0;
  v_scanner_failed integer := 0;
  v_calls integer := 0;
  v_passes integer := 0;
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

  -- Scanner-path health: a pass that ran reports itself in worker_pass_log.
  -- Counting the database timer's SQL status instead (the previous behaviour)
  -- reported 0 scanner failures while every other scanner call was being
  -- cancelled by the platform, because the SQL enqueue always succeeds.
  select
    count(*) filter (where outcome in ('processed', 'idle', 'busy')),
    count(*)
  into v_scanner_ok, v_passes
  from public.worker_pass_log
  where at > now() - interval '5 minutes'
    and source = 'worker_process';

  select count(*)
    into v_calls
    from cron.job_run_details d
    join cron.job j on j.command = d.command
   where d.start_time > now() - interval '5 minutes'
     and j.jobname in ('scan-worker-drain', 'scan-worker-drain-offset');

  -- Calls the database made that never produced a pass at all, plus passes the
  -- app itself reported as failed or cut off at its own deadline.
  v_scanner_failed := greatest(coalesce(v_calls, 0) - coalesce(v_passes, 0), 0)
    + (
      select count(*)
        from public.worker_pass_log
       where at > now() - interval '5 minutes'
         and source = 'worker_process'
         and outcome in ('error', 'deadline')
    );

  select left(coalesce(r.error_msg, r.content), 300)
    into v_detail
    from net._http_response r
   where r.created > now() - interval '5 minutes'
     and (r.status_code is null or r.status_code < 200 or r.status_code > 299)
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
    'scanner_ok', coalesce(v_scanner_ok, 0),
    'scanner_failed', coalesce(v_scanner_failed, 0)
  );
end;
$function$;