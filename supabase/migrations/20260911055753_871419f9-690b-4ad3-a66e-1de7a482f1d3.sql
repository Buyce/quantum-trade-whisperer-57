CREATE OR REPLACE FUNCTION public.acquire_market_data_slot(p_ttl_seconds integer DEFAULT 90)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(734612, 5);
  DELETE FROM public.market_data_slots WHERE expires_at < now();
  SELECT count(*) INTO v_count FROM public.market_data_slots;
  IF v_count >= 5 THEN RETURN NULL; END IF;
  INSERT INTO public.market_data_slots (expires_at)
  VALUES (now() + make_interval(secs => greatest(p_ttl_seconds, 5)))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.acquire_market_data_slot(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_market_data_slot(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.try_acquire_scan_worker_lease(
  p_holder text,
  p_ttl_seconds integer DEFAULT 25
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_acquired integer;
BEGIN
  DELETE FROM public.scan_worker_lease WHERE expires_at < now();
  INSERT INTO public.scan_worker_lease (id, holder, expires_at)
  VALUES (true, p_holder, now() + make_interval(secs => greatest(p_ttl_seconds, 5)))
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_acquired = ROW_COUNT;
  RETURN v_acquired > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.try_acquire_scan_worker_lease(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_scan_worker_lease(text, integer) TO service_role;

CREATE INDEX IF NOT EXISTS scan_queue_processing_started_idx
  ON public.scan_queue (started_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION private.kick_scan_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, net, public
AS $function$
DECLARE cfg private.scanner_config;
BEGIN
  SELECT * INTO cfg FROM private.scanner_config WHERE id;
  IF cfg IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := cfg.worker_base_url || '/api/public/worker/process',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cfg.cron_secret),
    body := jsonb_build_object('source', 'scan_queue_trigger'),
    timeout_milliseconds := 25000
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.kick_scan_worker() FROM PUBLIC, anon, authenticated;

DO $block$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'ptrades-scan-cycle' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_job_id, command := $command$
      SELECT net.http_post(
        url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/cron/scan',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)),
        body := '{"source":"pg_cron"}'::jsonb,
        timeout_milliseconds := 30000
      );
    $command$);
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.sample_worker_call_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ok integer := 0; v_failed integer := 0; v_timeout integer := 0;
  v_dns integer := 0; v_5xx integer := 0; v_scanner_ok integer := 0;
  v_scanner_failed integer := 0; v_expected integer := 0; v_reported integer := 0;
  v_last_at timestamptz; v_detail text;
BEGIN
  SELECT
    count(*) FILTER (WHERE status_code BETWEEN 200 AND 299),
    count(*) FILTER (WHERE status_code IS NULL OR status_code < 200 OR status_code > 299),
    count(*) FILTER (WHERE (status_code IS NULL OR status_code < 200 OR status_code > 299)
      AND error_msg ILIKE '%Timeout of%'
      AND coalesce((substring(error_msg FROM 'DNS time: ([0-9.]+) ms'))::numeric, 0)
        < 0.9 * coalesce((substring(error_msg FROM 'Timeout of ([0-9]+) ms'))::numeric, 0)),
    count(*) FILTER (WHERE (status_code IS NULL OR status_code < 200 OR status_code > 299)
      AND error_msg ILIKE '%Timeout of%'
      AND substring(error_msg FROM 'Timeout of ([0-9]+) ms') IS NOT NULL
      AND coalesce((substring(error_msg FROM 'DNS time: ([0-9.]+) ms'))::numeric, 0)
        >= 0.9 * (substring(error_msg FROM 'Timeout of ([0-9]+) ms'))::numeric),
    count(*) FILTER (WHERE status_code >= 500),
    max(created) FILTER (WHERE status_code IS NULL OR status_code < 200 OR status_code > 299)
  INTO v_ok, v_failed, v_timeout, v_dns, v_5xx, v_last_at
  FROM net._http_response WHERE created > now() - interval '5 minutes';

  SELECT count(*) FILTER (WHERE outcome IN ('processed', 'idle')),
         count(*) FILTER (WHERE outcome <> 'busy')
  INTO v_scanner_ok, v_reported
  FROM public.worker_pass_log
  WHERE at > now() - interval '5 minutes';

  SELECT count(*) INTO v_expected
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.start_time > now() - interval '5 minutes'
    AND j.jobname IN ('scan-worker-drain', 'scan-worker-drain-offset');

  v_scanner_failed := greatest(v_expected - v_reported, 0)
    + (SELECT count(*) FROM public.worker_pass_log
       WHERE at > now() - interval '5 minutes'
         AND outcome IN ('error', 'deadline', 'coordination_error'));

  SELECT left(coalesce(r.error_msg, r.content), 300) INTO v_detail
  FROM net._http_response r
  WHERE r.created > now() - interval '5 minutes'
    AND (r.status_code IS NULL OR r.status_code < 200 OR r.status_code > 299)
  ORDER BY r.created DESC LIMIT 1;

  INSERT INTO public.worker_call_health (
    window_minutes, ok, failed, failed_timeout, failed_dns, failed_5xx,
    scanner_ok, scanner_failed, last_failure_at, last_failure_detail
  ) VALUES (
    5, coalesce(v_ok, 0), coalesce(v_failed, 0), coalesce(v_timeout, 0),
    coalesce(v_dns, 0), coalesce(v_5xx, 0), coalesce(v_scanner_ok, 0),
    coalesce(v_scanner_failed, 0), v_last_at, v_detail
  );

  DELETE FROM public.worker_call_health WHERE sampled_at < now() - interval '7 days';
  RETURN jsonb_build_object('ok', coalesce(v_ok, 0), 'failed', coalesce(v_failed, 0),
    'scanner_ok', coalesce(v_scanner_ok, 0), 'scanner_failed', coalesce(v_scanner_failed, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.sample_worker_call_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_worker_call_health() TO postgres, service_role;