CREATE TABLE IF NOT EXISTS public.worker_call_health (
  id bigserial PRIMARY KEY,
  sampled_at timestamptz NOT NULL DEFAULT now(),
  window_minutes integer NOT NULL,
  ok integer NOT NULL,
  failed integer NOT NULL,
  last_failure_at timestamptz,
  last_failure_detail text
);

GRANT SELECT ON public.worker_call_health TO authenticated;
GRANT ALL ON public.worker_call_health TO service_role;

ALTER TABLE public.worker_call_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read worker call health" ON public.worker_call_health;
CREATE POLICY "admins read worker call health"
  ON public.worker_call_health FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS worker_call_health_recent_idx
  ON public.worker_call_health (sampled_at DESC);

CREATE OR REPLACE FUNCTION public.sample_worker_call_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ok integer := 0;
  v_failed integer := 0;
  v_last_at timestamptz;
  v_detail text;
BEGIN
  SELECT
    count(*) FILTER (WHERE status_code BETWEEN 200 AND 299),
    count(*) FILTER (WHERE status_code IS NULL OR status_code < 200 OR status_code > 299),
    max(created) FILTER (WHERE status_code IS NULL OR status_code < 200 OR status_code > 299)
  INTO v_ok, v_failed, v_last_at
  FROM net._http_response
  WHERE created > now() - interval '5 minutes';

  SELECT left(coalesce(r.error_msg, r.content), 300)
    INTO v_detail
    FROM net._http_response r
   WHERE r.created > now() - interval '5 minutes'
     AND (r.status_code IS NULL OR r.status_code < 200 OR r.status_code > 299)
   ORDER BY r.created DESC
   LIMIT 1;

  INSERT INTO public.worker_call_health (window_minutes, ok, failed, last_failure_at, last_failure_detail)
  VALUES (5, coalesce(v_ok, 0), coalesce(v_failed, 0), v_last_at, v_detail);

  DELETE FROM public.worker_call_health WHERE sampled_at < now() - interval '7 days';

  RETURN jsonb_build_object('ok', coalesce(v_ok, 0), 'failed', coalesce(v_failed, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.sample_worker_call_health() FROM public;

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