CREATE OR REPLACE FUNCTION public.get_admin_payoff_research()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '3000ms'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'cohorts', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.model_version, s.replay_version,
                                          s.estimand, s.tier, s.regime_key)
                           FROM payoff_stats s), '[]'::jsonb),
    -- Identity only: the immutable semantics document stays in the database so it
    -- can never be mistaken for client-side configuration.
    'registry', coalesce((SELECT jsonb_agg(jsonb_build_object(
                              'version', r.version,
                              'label', r.label,
                              'code_hash', r.code_hash,
                              'registered_at', r.registered_at,
                              'retired_at', r.retired_at) ORDER BY r.version)
                            FROM replay_versions r), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END;
$function$;