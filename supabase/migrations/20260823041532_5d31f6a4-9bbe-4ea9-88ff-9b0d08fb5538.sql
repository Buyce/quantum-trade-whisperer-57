ALTER TABLE public.shadow_engine_state
  ADD COLUMN IF NOT EXISTS paused_until timestamptz;

COMMENT ON COLUMN public.shadow_engine_state.paused_until IS
  'Circuit-breaker cooldown. While paused, the hourly resolve pass returns early until now() >= paused_until, then runs exactly one probe pass.';

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
    'last_finished_at', max(finished_at),
    'last_success_at', max(finished_at) FILTER (WHERE status = 'done'),
    'last_failure_at', max(finished_at) FILTER (WHERE status = 'failed'),
    'last_error', (SELECT error FROM scan_queue
                    WHERE status = 'failed' AND error IS NOT NULL
                      AND finished_at > now() - interval '60 minutes'
                    ORDER BY finished_at DESC LIMIT 1)
  ) INTO v_scan
    FROM scan_queue
   WHERE finished_at > now() - interval '60 minutes';

  RETURN jsonb_build_object(
    'generated_at', now(),
    'breaker', coalesce(v_breaker, 'null'::jsonb),
    'scan', v_scan
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_engine_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_engine_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_engine_status() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_reset_shadow_breaker()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE shadow_engine_state
     SET paused = false,
         consecutive_failures = 0,
         paused_until = NULL,
         last_error = NULL,
         updated_at = now()
   WHERE id = true
  RETURNING to_jsonb(shadow_engine_state.*) - 'id' INTO v_row;

  RETURN jsonb_build_object('ok', v_row IS NOT NULL, 'state', coalesce(v_row, 'null'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reset_shadow_breaker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_shadow_breaker() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_shadow_breaker() TO service_role;