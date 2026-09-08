-- lovable-cron-fallback-reviewed: 1440 runs/day; pre-existing every-minute scan drain, unchanged cadence. Scan work is enqueued every 15 minutes and is discarded if not picked up within 15 minutes, so this is the reconciliation backstop for the insert trigger and self-chain; it is now guarded by WHERE EXISTS so idle minutes make no call.
ALTER TABLE public.worker_call_health
  ADD COLUMN IF NOT EXISTS failed_timeout integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_dns integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.sample_worker_call_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok integer := 0;
  v_failed integer := 0;
  v_timeout integer := 0;
  v_dns integer := 0;
  v_last_at timestamptz;
  v_detail text;
BEGIN
  SELECT
    count(*) FILTER (WHERE status_code BETWEEN 200 AND 299),
    count(*) FILTER (WHERE status_code IS NULL OR status_code < 200 OR status_code > 299),
    -- A timeout with the whole elapsed time spent in DNS is an upstream name
    -- lookup stall, not our handler being slow: the two are counted apart so the
    -- Admin card can name the actual fault.
    count(*) FILTER (
      WHERE (status_code IS NULL OR status_code < 200 OR status_code > 299)
        AND error_msg ILIKE '%Timeout of%'
        AND error_msg !~ 'DNS time: [1-9]'
    ),
    count(*) FILTER (
      WHERE (status_code IS NULL OR status_code < 200 OR status_code > 299)
        AND error_msg ~ 'DNS time: [1-9]'
    ),
    max(created) FILTER (WHERE status_code IS NULL OR status_code < 200 OR status_code > 299)
  INTO v_ok, v_failed, v_timeout, v_dns, v_last_at
  FROM net._http_response
  WHERE created > now() - interval '5 minutes';

  SELECT left(coalesce(r.error_msg, r.content), 300)
    INTO v_detail
    FROM net._http_response r
   WHERE r.created > now() - interval '5 minutes'
     AND (r.status_code IS NULL OR r.status_code < 200 OR r.status_code > 299)
   ORDER BY r.created DESC
   LIMIT 1;

  INSERT INTO public.worker_call_health (
    window_minutes, ok, failed, failed_timeout, failed_dns, last_failure_at, last_failure_detail
  )
  VALUES (
    5, coalesce(v_ok, 0), coalesce(v_failed, 0), coalesce(v_timeout, 0), coalesce(v_dns, 0),
    v_last_at, v_detail
  );

  DELETE FROM public.worker_call_health WHERE sampled_at < now() - interval '7 days';

  RETURN jsonb_build_object(
    'ok', coalesce(v_ok, 0),
    'failed', coalesce(v_failed, 0),
    'failed_timeout', coalesce(v_timeout, 0),
    'failed_dns', coalesce(v_dns, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_engine_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '3000ms'
AS $function$
DECLARE
  v_breaker jsonb;
  v_scan jsonb;
  v_link jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT to_jsonb(e) INTO v_breaker
    FROM (
      SELECT paused, paused_until, consecutive_failures, last_error, last_run_at
        FROM shadow_engine_state
       LIMIT 1
    ) e;

  SELECT jsonb_build_object(
    'window_minutes', 60,
    'total', count(*),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'succeeded', count(*) FILTER (WHERE status = 'done'),
    'stale', count(*) FILTER (WHERE result = 'stale'),
    'analysed', count(*) FILTER (WHERE result IS NOT NULL AND result <> 'stale'),
    'last_finished_at', max(finished_at),
    'last_success_at', max(finished_at) FILTER (WHERE status = 'done'),
    'last_failure_at', max(finished_at) FILTER (WHERE status = 'failed'),
    'last_analysed_at', (SELECT max(finished_at) FROM scan_queue
                          WHERE result IS NOT NULL AND result <> 'stale'),
    'last_candle_fetch_at', (SELECT max(observed_at) FROM metaapi_api_observations
                              WHERE surface = 'market-data' AND outcome = 'ok'),
    'last_error', (SELECT error FROM scan_queue
                    WHERE status = 'failed' AND error IS NOT NULL
                      AND finished_at > now() - interval '60 minutes'
                    ORDER BY finished_at DESC LIMIT 1)
  ) INTO v_scan
    FROM scan_queue
   WHERE finished_at > now() - interval '60 minutes';

  SELECT jsonb_build_object(
    'window_minutes', 60,
    'ok', coalesce(sum(ok), 0),
    'failed', coalesce(sum(failed), 0),
    'failed_timeout', coalesce(sum(failed_timeout), 0),
    'failed_dns', coalesce(sum(failed_dns), 0),
    'last_failure_at', max(last_failure_at),
    'last_failure_detail', (SELECT last_failure_detail FROM worker_call_health
                             WHERE last_failure_detail IS NOT NULL
                             ORDER BY sampled_at DESC LIMIT 1),
    'last_sampled_at', max(sampled_at)
  ) INTO v_link
    FROM worker_call_health
   WHERE sampled_at > now() - interval '60 minutes';

  RETURN jsonb_build_object(
    'generated_at', now(),
    'breaker', coalesce(v_breaker, 'null'::jsonb),
    'scan', v_scan,
    'link', v_link
  );
END;
$function$;

-- The offset drain fired every minute whether or not work was waiting, and gave
-- the app exactly the same 20s the handler itself budgeted, so a busy pass was
-- always cut off mid-work and recorded as a failed call. Both are corrected.
SELECT cron.unschedule('scan-worker-drain-offset');
SELECT cron.schedule(
  'scan-worker-drain-offset',
  '* * * * *',
  $$
  SELECT pg_sleep(30);
  SELECT net.http_post(
    url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/worker/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
    ),
    body := jsonb_build_object('source', 'pg_cron_drain_offset'),
    timeout_milliseconds := 25000
  )
  WHERE EXISTS (SELECT 1 FROM public.scan_queue WHERE status = 'pending');
  $$
);