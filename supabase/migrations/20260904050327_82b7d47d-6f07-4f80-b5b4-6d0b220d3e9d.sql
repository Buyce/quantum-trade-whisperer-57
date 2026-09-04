CREATE OR REPLACE FUNCTION public.gate_readiness()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g text;
  mh text;
  v_days integer;
  v_rows jsonb := '[]'::jsonb;
  v_decidable boolean;
  v_train boolean;
  v_verdict text;
  v_current numeric;
  v_auto boolean;
  p_n integer; f_n integer;
  p_cl integer; f_cl integer;
  p_mean numeric; f_mean numeric;
  p_se numeric; f_se numeric;
  p_st text; f_st text;
BEGIN
  IF NOT (public.is_admin() OR current_user IN ('service_role', 'postgres', 'supabase_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(DISTINCT se.detected_at::date) INTO v_days
    FROM shadow_executions se
   WHERE se.cohort = 'research_candidate'
     AND se.status = 'resolved';

  SELECT auto_apply_gate_changes INTO v_auto FROM shadow_engine_state WHERE id;

  FOREACH g IN ARRAY ARRAY['risk_ceiling', 'headroom', 'reachable_r'] LOOP
    mh := NULL; v_verdict := NULL;
    p_n := NULL; f_n := NULL; p_cl := NULL; f_cl := NULL;
    p_mean := NULL; f_mean := NULL; p_se := NULL; f_se := NULL;
    p_st := NULL; f_st := NULL;

    SELECT s.manifest_hash INTO mh
      FROM filter_lift_stats s
     WHERE s.gate = g AND s.slice_dim = 'global'
     GROUP BY s.manifest_hash
     ORDER BY sum(s.n_candidates) DESC NULLS LAST
     LIMIT 1;

    IF mh IS NOT NULL THEN
      SELECT n_used, cluster_n, mean_r, se_r, stat_status
        INTO p_n, p_cl, p_mean, p_se, p_st
        FROM filter_lift_stats
       WHERE gate = g AND slice_dim = 'global' AND arm = 'pass' AND manifest_hash = mh
       LIMIT 1;
      SELECT n_used, cluster_n, mean_r, se_r, stat_status
        INTO f_n, f_cl, f_mean, f_se, f_st
        FROM filter_lift_stats
       WHERE gate = g AND slice_dim = 'global' AND arm = 'fail' AND manifest_hash = mh
       LIMIT 1;
    END IF;

    v_decidable := coalesce(p_st = 'descriptive', false)
                   AND coalesce(f_st = 'descriptive', false)
                   AND coalesce(p_n, 0) >= 30 AND coalesce(f_n, 0) >= 30
                   AND p_se IS NOT NULL AND f_se IS NOT NULL
                   AND p_mean IS NOT NULL AND f_mean IS NOT NULL;

    IF v_decidable THEN
      IF f_mean - 1.96 * f_se > p_mean + 1.96 * p_se THEN
        v_verdict := 'loosening_supported';
      ELSIF p_mean - 1.96 * p_se > f_mean + 1.96 * f_se THEN
        v_verdict := 'gate_supported';
      END IF;
    END IF;

    v_train := v_decidable AND v_verdict IS NOT NULL
               AND coalesce(p_n, 0) >= 200 AND coalesce(f_n, 0) >= 200
               AND coalesce(p_cl, 0) >= 10 AND coalesce(f_cl, 0) >= 10
               AND coalesce(v_days, 0) >= 20;

    v_current := NULL;
    SELECT o.value INTO v_current FROM gate_threshold_overrides o WHERE o.gate = g;

    v_rows := v_rows || jsonb_build_object(
      'gate', g,
      'manifest_hash', mh,
      'current_value', coalesce(v_current, public.gate_default_value(g)),
      'override_active', v_current IS NOT NULL,
      'pass_n_used', p_n,
      'fail_n_used', f_n,
      'pass_cluster_n', p_cl,
      'fail_cluster_n', f_cl,
      'pass_mean_r', p_mean,
      'fail_mean_r', f_mean,
      'pass_status', p_st,
      'fail_status', f_st,
      'decidable', coalesce(v_decidable, false),
      'verdict', v_verdict,
      'training_ready', coalesce(v_train, false)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'as_of', now(),
    'trading_days', coalesce(v_days, 0),
    'min_trading_days', 20,
    'min_samples_per_arm', 200,
    'min_clusters_per_arm', 10,
    'auto_apply_enabled', coalesce(v_auto, false),
    'gates', v_rows,
    'ready', coalesce((SELECT bool_or((r->>'training_ready')::boolean) FROM jsonb_array_elements(v_rows) r), false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gate_readiness() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gate_readiness() FROM anon;
GRANT EXECUTE ON FUNCTION public.gate_readiness() TO authenticated, service_role;