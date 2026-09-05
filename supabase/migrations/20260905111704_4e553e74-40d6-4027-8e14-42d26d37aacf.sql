CREATE TABLE IF NOT EXISTS public.walk_forward_confirmations (
  gate text PRIMARY KEY,
  confirmed boolean NOT NULL DEFAULT false,
  split_day text,
  train_days integer NOT NULL DEFAULT 0,
  holdout_days integer NOT NULL DEFAULT 0,
  train_pass_n integer NOT NULL DEFAULT 0,
  train_fail_n integer NOT NULL DEFAULT 0,
  holdout_pass_n integer NOT NULL DEFAULT 0,
  holdout_fail_n integer NOT NULL DEFAULT 0,
  train_delta_r numeric,
  holdout_delta_r numeric,
  holdout_low numeric,
  holdout_high numeric,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail text NOT NULL DEFAULT '',
  computed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.walk_forward_confirmations TO authenticated;
GRANT ALL ON public.walk_forward_confirmations TO service_role;

ALTER TABLE public.walk_forward_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read walk forward" ON public.walk_forward_confirmations;
CREATE POLICY "admins read walk forward"
  ON public.walk_forward_confirmations FOR SELECT TO authenticated
  USING (public.is_admin());

-- A gate may only change when a recent walk-forward pass confirmed the
-- difference on a later, unseen period. Missing or stale evidence is NOT a
-- confirmation: it can only withhold a change, never authorise one.
CREATE OR REPLACE FUNCTION public.walk_forward_confirmed(_gate text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.walk_forward_confirmations w
     WHERE w.gate = _gate
       AND w.confirmed
       AND w.computed_at > now() - interval '36 hours'
  )
$$;

CREATE OR REPLACE FUNCTION public.run_gate_change_automation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  withheld jsonb := '[]'::jsonb;
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

    -- Walk-forward bar: the same difference must have been reproduced on a
    -- later, unseen period. An in-sample difference alone proposes nothing.
    IF NOT public.walk_forward_confirmed(g) THEN
      withheld := withheld || jsonb_build_object('gate', g, 'reason', 'no fresh out-of-sample confirmation');
      CONTINUE;
    END IF;

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
        'training_ready', r->'training_ready',
        'walk_forward', (SELECT to_jsonb(w) FROM walk_forward_confirmations w WHERE w.gate = g)
      ),
      v_verdict,
      'system:auto_propose',
      format('automatic: %s at 95%% on %s pass / %s fail matured samples across %s trading days, confirmed out of sample',
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
      -- Re-checked at application time, not only at proposal time.
      CONTINUE WHEN NOT public.walk_forward_confirmed(v_prop.gate);
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
    'reverted', reverted,
    'withheld_pending_walk_forward', withheld
  );
END;
$function$;