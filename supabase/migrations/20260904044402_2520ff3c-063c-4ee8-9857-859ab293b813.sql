-- 1. Notification latch + owner switch
ALTER TABLE public.shadow_engine_state
  ADD COLUMN IF NOT EXISTS model_readiness_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_apply_gate_changes boolean NOT NULL DEFAULT false;

-- 2. Proposal provenance
ALTER TABLE public.gate_change_proposals
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'operator',
  ADD COLUMN IF NOT EXISTS auto_applied boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gate_change_proposals_origin_check') THEN
    ALTER TABLE public.gate_change_proposals
      ADD CONSTRAINT gate_change_proposals_origin_check
      CHECK (origin IN ('operator', 'system'));
  END IF;
END $$;

-- 3. Milestone latch knows the readiness gate
CREATE OR REPLACE FUNCTION public.claim_learning_milestone(_gate text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed integer := 0;
BEGIN
  IF _gate = 'fill' THEN
    UPDATE public.shadow_engine_state
       SET fill_gate_notified_at = now()
     WHERE id AND fill_gate_notified_at IS NULL;
    GET DIAGNOSTICS claimed = ROW_COUNT;
  ELSIF _gate = 'win' THEN
    UPDATE public.shadow_engine_state
       SET win_gate_notified_at = now()
     WHERE id AND win_gate_notified_at IS NULL;
    GET DIAGNOSTICS claimed = ROW_COUNT;
  ELSIF _gate = 'model_readiness' THEN
    UPDATE public.shadow_engine_state
       SET model_readiness_notified_at = now()
     WHERE id AND model_readiness_notified_at IS NULL;
    GET DIAGNOSTICS claimed = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'unknown gate: %', _gate;
  END IF;

  RETURN claimed > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_learning_milestone(_gate text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _gate = 'fill' THEN
    UPDATE public.shadow_engine_state SET fill_gate_notified_at = NULL WHERE id;
  ELSIF _gate = 'win' THEN
    UPDATE public.shadow_engine_state SET win_gate_notified_at = NULL WHERE id;
  ELSIF _gate = 'model_readiness' THEN
    UPDATE public.shadow_engine_state SET model_readiness_notified_at = NULL WHERE id;
  END IF;
END;
$$;

-- 4. Compiled-in defaults, mirrored for the automation's step arithmetic.
CREATE OR REPLACE FUNCTION public.gate_default_value(_gate text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _gate
           WHEN 'risk_ceiling' THEN 3::numeric
           WHEN 'headroom' THEN 2.5::numeric
           WHEN 'reachable_r' THEN 1::numeric
         END;
$$;

-- 5. Readiness report: what the evidence actually supports, per gate.
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
  p record;
  f record;
  v_days integer;
  v_rows jsonb := '[]'::jsonb;
  v_decidable boolean;
  v_train boolean;
  v_verdict text;
  v_current numeric;
  v_auto boolean;
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

    SELECT s.manifest_hash INTO mh
      FROM filter_lift_stats s
     WHERE s.gate = g AND s.slice_dim = 'global'
     GROUP BY s.manifest_hash
     ORDER BY sum(s.n_candidates) DESC NULLS LAST
     LIMIT 1;

    p := NULL; f := NULL;
    IF mh IS NOT NULL THEN
      SELECT * INTO p FROM filter_lift_stats
       WHERE gate = g AND slice_dim = 'global' AND arm = 'pass' AND manifest_hash = mh;
      SELECT * INTO f FROM filter_lift_stats
       WHERE gate = g AND slice_dim = 'global' AND arm = 'fail' AND manifest_hash = mh;
    END IF;

    v_decidable := p.stat_status = 'descriptive' AND f.stat_status = 'descriptive'
                   AND coalesce(p.n_used, 0) >= 30 AND coalesce(f.n_used, 0) >= 30
                   AND p.se_r IS NOT NULL AND f.se_r IS NOT NULL;

    IF v_decidable THEN
      IF f.mean_r - 1.96 * f.se_r > p.mean_r + 1.96 * p.se_r THEN
        v_verdict := 'loosening_supported';
      ELSIF p.mean_r - 1.96 * p.se_r > f.mean_r + 1.96 * f.se_r THEN
        v_verdict := 'gate_supported';
      END IF;
    END IF;

    v_train := v_decidable AND v_verdict IS NOT NULL
               AND coalesce(p.n_used, 0) >= 200 AND coalesce(f.n_used, 0) >= 200
               AND coalesce(p.cluster_n, 0) >= 10 AND coalesce(f.cluster_n, 0) >= 10
               AND coalesce(v_days, 0) >= 20;

    SELECT o.value INTO v_current FROM gate_threshold_overrides o WHERE o.gate = g;

    v_rows := v_rows || jsonb_build_object(
      'gate', g,
      'manifest_hash', mh,
      'current_value', coalesce(v_current, public.gate_default_value(g)),
      'override_active', v_current IS NOT NULL,
      'pass_n_used', p.n_used,
      'fail_n_used', f.n_used,
      'pass_cluster_n', p.cluster_n,
      'fail_cluster_n', f.cluster_n,
      'pass_mean_r', p.mean_r,
      'fail_mean_r', f.mean_r,
      'pass_status', p.stat_status,
      'fail_status', f.stat_status,
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
    'ready', (SELECT bool_or((r->>'training_ready')::boolean) FROM jsonb_array_elements(v_rows) r)
  );
END;
$$;

-- 6. Owner-only switch for automatic application.
CREATE OR REPLACE FUNCTION public.set_auto_apply_gate_changes(_enabled boolean, _actor text, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF coalesce(btrim(_reason), '') = '' OR coalesce(btrim(_actor), '') = '' THEN
    RAISE EXCEPTION 'a change requires a named actor and a reason';
  END IF;

  SELECT auto_apply_gate_changes INTO v_old FROM shadow_engine_state WHERE id FOR UPDATE;
  UPDATE shadow_engine_state SET auto_apply_gate_changes = _enabled, updated_at = now() WHERE id;

  INSERT INTO execution_control_changes (changed_by, reason, control_key, old_value, new_value, evidence)
  VALUES (_actor, _reason, 'gate.auto_apply',
          jsonb_build_object('enabled', v_old), jsonb_build_object('enabled', _enabled),
          jsonb_build_object('source', 'set_auto_apply_gate_changes'));

  RETURN jsonb_build_object('ok', true, 'enabled', _enabled, 'previous', v_old);
END;
$$;

-- 7. The automation. Service role only: this is the cron's path, never a user's.
CREATE OR REPLACE FUNCTION public.run_gate_change_automation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  readiness jsonb;
  r jsonb;
  g text;
  v_verdict text;
  v_current numeric;
  v_proposed numeric;
  v_id uuid;
  v_auto boolean;
  v_prop record;
  v_now_pass record;
  v_snap_mean numeric;
  proposed jsonb := '[]'::jsonb;
  applied jsonb := '[]'::jsonb;
  reverted jsonb := '[]'::jsonb;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('run_gate_change_automation'));

  readiness := public.gate_readiness();
  v_auto := coalesce((readiness->>'auto_apply_enabled')::boolean, false);

  -- (a) Open a system proposal where the evidence reads a verdict.
  FOR r IN SELECT * FROM jsonb_array_elements(readiness->'gates') LOOP
    g := r->>'gate';
    v_verdict := r->>'verdict';
    CONTINUE WHEN v_verdict IS NULL;
    CONTINUE WHEN NOT coalesce((r->>'decidable')::boolean, false);
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM gate_change_proposals WHERE gate = g AND status = 'proposed'
    );

    v_current := (r->>'current_value')::numeric;

    -- One conservative 10% step. Loosening relaxes the gate, gate_supported
    -- tightens it; direction depends on which way the gate points.
    IF g = 'risk_ceiling' THEN
      v_proposed := CASE WHEN v_verdict = 'loosening_supported'
                         THEN round(v_current * 1.10, 4) ELSE round(v_current * 0.90, 4) END;
    ELSE
      v_proposed := CASE WHEN v_verdict = 'loosening_supported'
                         THEN round(v_current * 0.90, 4) ELSE round(v_current * 1.10, 4) END;
    END IF;

    CONTINUE WHEN v_proposed IS NULL OR v_proposed <= 0 OR v_proposed = v_current;

    INSERT INTO gate_change_proposals (
      gate, current_value, proposed_value, stats_snapshot, verdict,
      proposed_by, decision_reason, origin
    ) VALUES (
      g,
      CASE WHEN coalesce((r->>'override_active')::boolean, false) THEN v_current ELSE NULL END,
      v_proposed,
      jsonb_build_object(
        'as_of', readiness->>'as_of',
        'manifest_hash', r->>'manifest_hash',
        'pass', jsonb_build_object('mean_r', r->'pass_mean_r', 'se_r', NULL,
                                   'n_used', r->'pass_n_used', 'cluster_n', r->'pass_cluster_n'),
        'fail', jsonb_build_object('mean_r', r->'fail_mean_r', 'se_r', NULL,
                                   'n_used', r->'fail_n_used', 'cluster_n', r->'fail_cluster_n'),
        'trading_days', readiness->'trading_days',
        'training_ready', r->'training_ready'
      ),
      v_verdict,
      'system:auto_propose',
      format('automatic: %s at 95%% on %s pass / %s fail matured samples across %s trading days',
             v_verdict, r->>'pass_n_used', r->>'fail_n_used', readiness->>'trading_days'),
      'system'
    ) RETURNING id INTO v_id;

    proposed := proposed || jsonb_build_object(
      'id', v_id, 'gate', g, 'verdict', v_verdict,
      'current_value', v_current, 'proposed_value', v_proposed);
  END LOOP;

  -- (b) Apply automatically ONLY under the owner switch and the strict bar.
  IF v_auto THEN
    FOR v_prop IN
      SELECT p.* FROM gate_change_proposals p
       WHERE p.status = 'proposed' AND p.origin = 'system'
       ORDER BY p.created_at
    LOOP
      SELECT * INTO r FROM jsonb_array_elements(readiness->'gates') x
       WHERE x->>'gate' = v_prop.gate;
      CONTINUE WHEN r IS NULL;
      CONTINUE WHEN NOT coalesce((r->>'training_ready')::boolean, false);
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM gate_change_proposals q
         WHERE q.gate = v_prop.gate AND q.auto_applied
           AND q.applied_at IS NOT NULL AND q.applied_at > now() - interval '7 days'
      );

      INSERT INTO gate_threshold_overrides (gate, value, set_by, reason, proposal_id, updated_at)
      VALUES (v_prop.gate, v_prop.proposed_value, 'system:auto_apply',
              coalesce(v_prop.decision_reason, 'automatic application'), v_prop.id, now())
      ON CONFLICT (gate) DO UPDATE
        SET value = EXCLUDED.value, set_by = EXCLUDED.set_by, reason = EXCLUDED.reason,
            proposal_id = EXCLUDED.proposal_id, updated_at = now();

      INSERT INTO execution_control_changes (changed_by, reason, control_key, old_value, new_value, evidence)
      VALUES ('system:auto_apply', coalesce(v_prop.decision_reason, 'automatic application'),
              'gate.' || v_prop.gate,
              CASE WHEN v_prop.current_value IS NULL THEN NULL::jsonb
                   ELSE jsonb_build_object('gate', v_prop.gate, 'value', v_prop.current_value) END,
              jsonb_build_object('gate', v_prop.gate, 'value', v_prop.proposed_value),
              jsonb_build_object('proposal_id', v_prop.id, 'auto_applied', true,
                                 'stats_snapshot', v_prop.stats_snapshot));

      UPDATE gate_change_proposals
         SET status = 'approved', decided_by = 'system:auto_apply', decided_at = now(),
             applied_at = now(), auto_applied = true
       WHERE id = v_prop.id;

      applied := applied || jsonb_build_object(
        'id', v_prop.id, 'gate', v_prop.gate,
        'value', v_prop.proposed_value, 'verdict', v_prop.verdict);
    END LOOP;
  END IF;

  -- (c) Auto-revert an automatic change whose post-change cohort is worse.
  FOR v_prop IN
    SELECT p.* FROM gate_change_proposals p
     WHERE p.status = 'approved' AND p.auto_applied AND p.applied_at IS NOT NULL
  LOOP
    v_snap_mean := nullif(v_prop.stats_snapshot->'pass'->>'mean_r', '')::numeric;
    CONTINUE WHEN v_snap_mean IS NULL;

    SELECT s.* INTO v_now_pass
      FROM filter_lift_stats s
     WHERE s.gate = v_prop.gate AND s.slice_dim = 'global' AND s.arm = 'pass'
       AND s.manifest_hash IS DISTINCT FROM (v_prop.stats_snapshot->>'manifest_hash')
       AND s.computed_as_of > v_prop.applied_at
     ORDER BY s.n_used DESC NULLS LAST
     LIMIT 1;

    CONTINUE WHEN v_now_pass IS NULL;
    CONTINUE WHEN coalesce(v_now_pass.n_used, 0) < 100;
    CONTINUE WHEN v_now_pass.mean_r IS NULL OR v_now_pass.mean_r >= v_snap_mean;

    IF v_prop.current_value IS NULL THEN
      DELETE FROM gate_threshold_overrides WHERE gate = v_prop.gate;
    ELSE
      INSERT INTO gate_threshold_overrides (gate, value, set_by, reason, proposal_id, updated_at)
      VALUES (v_prop.gate, v_prop.current_value, 'system:auto_revert',
              'post-change cohort is worse than the pre-change pass arm', v_prop.id, now())
      ON CONFLICT (gate) DO UPDATE
        SET value = EXCLUDED.value, set_by = EXCLUDED.set_by, reason = EXCLUDED.reason,
            proposal_id = EXCLUDED.proposal_id, updated_at = now();
    END IF;

    INSERT INTO execution_control_changes (changed_by, reason, control_key, old_value, new_value, evidence)
    VALUES ('system:auto_revert', 'post-change cohort is worse than the pre-change pass arm',
            'gate.' || v_prop.gate,
            jsonb_build_object('gate', v_prop.gate, 'value', v_prop.proposed_value),
            CASE WHEN v_prop.current_value IS NULL THEN NULL::jsonb
                 ELSE jsonb_build_object('gate', v_prop.gate, 'value', v_prop.current_value) END,
            jsonb_build_object('proposal_id', v_prop.id, 'auto_reverted', true,
                               'post_change_mean_r', v_now_pass.mean_r,
                               'post_change_n_used', v_now_pass.n_used,
                               'pre_change_mean_r', v_snap_mean));

    UPDATE gate_change_proposals
       SET status = 'reverted', decided_by = 'system:auto_revert',
           decision_reason = 'post-change cohort is worse than the pre-change pass arm',
           decided_at = now(), reverted_at = now()
     WHERE id = v_prop.id;

    reverted := reverted || jsonb_build_object(
      'id', v_prop.id, 'gate', v_prop.gate,
      'post_change_mean_r', v_now_pass.mean_r, 'pre_change_mean_r', v_snap_mean);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'auto_apply_enabled', v_auto,
    'readiness', readiness,
    'proposed', proposed,
    'applied', applied,
    'reverted', reverted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_gate_change_automation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_gate_change_automation() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_gate_change_automation() TO service_role;

REVOKE ALL ON FUNCTION public.gate_readiness() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gate_readiness() FROM anon;
GRANT EXECUTE ON FUNCTION public.gate_readiness() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_auto_apply_gate_changes(boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_auto_apply_gate_changes(boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_auto_apply_gate_changes(boolean, text, text) TO authenticated, service_role;