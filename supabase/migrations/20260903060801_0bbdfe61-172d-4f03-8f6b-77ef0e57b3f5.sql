-- Stage 1: close the learning measurement loop.

-- 1. Slice columns on filter_lift_stats (global row + instrument/direction/session slices)
ALTER TABLE public.filter_lift_stats
  ADD COLUMN IF NOT EXISTS slice_dim text NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS slice_key text NOT NULL DEFAULT '';

ALTER TABLE public.filter_lift_stats DROP CONSTRAINT filter_lift_stats_pkey;
ALTER TABLE public.filter_lift_stats
  ADD CONSTRAINT filter_lift_stats_pkey
  PRIMARY KEY (manifest_hash, gate, arm, plan_origin, slice_dim, slice_key);

-- 2. Gate change proposal ledger (owner-approved only, never auto-applied)
CREATE TABLE public.gate_change_proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gate text NOT NULL CHECK (gate IN ('risk_ceiling','headroom','reachable_r')),
  current_value numeric,          -- NULL means the code default was in force
  proposed_value numeric NOT NULL CHECK (proposed_value > 0),
  stats_snapshot jsonb NOT NULL,  -- frozen arm rows at proposal time (as_of provenance)
  verdict text NOT NULL CHECK (verdict IN ('loosening_supported','gate_supported')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','reverted')),
  proposed_by text NOT NULL,
  decided_by text,
  decision_reason text,
  decided_at timestamptz,
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.gate_change_proposals TO service_role;
ALTER TABLE public.gate_change_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read gate change proposals" ON public.gate_change_proposals
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER touch_gate_change_proposals_updated_at BEFORE UPDATE ON public.gate_change_proposals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Active gate threshold overrides, one row per gate, written only by an approved proposal
CREATE TABLE public.gate_threshold_overrides (
  gate text PRIMARY KEY CHECK (gate IN ('risk_ceiling','headroom','reachable_r')),
  value numeric NOT NULL CHECK (value > 0),
  set_by text NOT NULL,
  reason text NOT NULL,
  proposal_id uuid REFERENCES public.gate_change_proposals(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.gate_threshold_overrides TO service_role;
ALTER TABLE public.gate_threshold_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read gate threshold overrides" ON public.gate_threshold_overrides
  FOR SELECT TO authenticated USING (public.is_admin());

-- 4. recompute_filter_lift: slice rows + cluster-robust standard errors
CREATE OR REPLACE FUNCTION public.recompute_filter_lift(_horizon_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hz integer := coalesce(_horizon_hours, 24);
  as_of timestamptz;
  this_run uuid := gen_random_uuid();
  out_rows integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('recompute_filter_lift'));
  as_of := clock_timestamp();

  -- Research cohort ONLY, Replay-V1 ONLY, the exact approved execution policy,
  -- and the common research ladder ONLY. plan_origin is pinned rather than
  -- grouped on: comparing a headroom-conditioned production ladder against an
  -- unconditional research ladder would measure the ladder, not the filter.
  CREATE TEMP TABLE _fl_src ON COMMIT DROP AS
    SELECT c.manifest_hash,
           c.strategy_version,
           c.instrument,
           coalesce(c.direction, 'unknown') AS direction,
           coalesce(c.trading_session, 'unknown') AS session,
           g->>'gate' AS gate,
           g->>'outcome' AS outcome,
           se.id AS execution_id,
           (se.detected_at + make_interval(hours => hz) <= as_of) AS mature,
           (se.status = 'resolved') AS resolved,
           se.data_quality_outcome,
           se.resolved_outcome,
           se.realized_r::numeric AS r_value,
           (date_trunc('day', se.detected_at)::date::text || '|' || se.instrument) AS cluster_key
      FROM research_candidates c
      JOIN shadow_executions se
        ON se.research_candidate_id = c.id
       AND se.cohort = 'research_candidate'
       AND se.plan_origin = 'counterfactual'
       AND se.replay_version = 1
       AND se.execution_policy = 'legacy_best_target_touched'
      CROSS JOIN LATERAL jsonb_array_elements(c.gates) g
     WHERE c.gates_complete
       AND c.cf_plan_version IS NOT NULL
       AND g->>'outcome' IN ('pass', 'fail');

  CREATE TEMP TABLE _fl_class ON COMMIT DROP AS
    SELECT s.*,
           CASE
             WHEN NOT s.mature OR NOT s.resolved THEN 'unresolved'
             WHEN s.data_quality_outcome = 'invalid_plan' THEN 'invalid'
             WHEN s.data_quality_outcome = 'gap_beyond_stop' THEN 'gap_no_trade'
             WHEN s.resolved_outcome = 'never_filled' THEN 'never_filled'
             WHEN s.r_value IS NULL THEN 'invalid'
             ELSE 'executable'
           END AS klass,
           CASE
             WHEN s.data_quality_outcome = 'invalid_plan' THEN NULL
             WHEN s.data_quality_outcome = 'gap_beyond_stop' THEN 0::numeric
             WHEN s.resolved_outcome = 'never_filled' THEN 0::numeric
             ELSE s.r_value
           END AS r_eff
      FROM _fl_src s;

  -- Global row plus per-slice rows. A slice thinner than the floors below is
  -- reported as its own 'not yet decidable' row, never folded into the global
  -- number and never rounded up.
  CREATE TEMP TABLE _fl_g ON COMMIT DROP AS
    SELECT manifest_hash, strategy_version, 'global' AS slice_dim, ''::text AS slice_key,
           gate, outcome AS arm, mature, klass, r_eff, cluster_key
      FROM _fl_class
    UNION ALL
    SELECT manifest_hash, strategy_version, 'instrument', instrument,
           gate, outcome, mature, klass, r_eff, cluster_key FROM _fl_class
    UNION ALL
    SELECT manifest_hash, strategy_version, 'direction', direction,
           gate, outcome, mature, klass, r_eff, cluster_key FROM _fl_class
    UNION ALL
    SELECT manifest_hash, strategy_version, 'session', session,
           gate, outcome, mature, klass, r_eff, cluster_key FROM _fl_class;

  DELETE FROM filter_lift_stats;

  -- Cluster totals (instrument-day). Overlapping research plans are not
  -- independent, so the interval is cluster-robust: the standard error of the
  -- mean is built from cluster totals, not from individual plans.
  CREATE TEMP TABLE _fl_clus ON COMMIT DROP AS
    SELECT manifest_hash, strategy_version, slice_dim, slice_key, gate, arm, cluster_key,
           count(*) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS n_c,
           sum(r_eff) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS t_c
      FROM _fl_g
     GROUP BY 1,2,3,4,5,6,7;

  WITH agg AS (
    SELECT manifest_hash, strategy_version, slice_dim, slice_key, gate, arm,
           count(*) AS n_candidates,
           count(*) FILTER (WHERE mature) AS n_mature,
           count(*) FILTER (WHERE klass <> 'unresolved') AS n_resolved,
           count(*) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS n_used,
           avg(r_eff) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS mean_r,
           stddev_samp(r_eff) FILTER (WHERE klass IN ('executable','never_filled','gap_no_trade')) AS sd_r
      FROM _fl_g
     GROUP BY 1,2,3,4,5,6
  ), ca AS (
    SELECT manifest_hash, strategy_version, slice_dim, slice_key, gate, arm,
           count(*) AS cluster_n,
           sum(n_c) AS n_tot,
           sum(t_c) AS t_tot
      FROM _fl_clus
     GROUP BY 1,2,3,4,5,6
  ), se AS (
    SELECT c.manifest_hash, c.strategy_version, c.slice_dim, c.slice_key, c.gate, c.arm,
           CASE
             WHEN count(*) >= 2 AND sum(c.n_c) > 0 THEN
               sqrt(
                 (count(*)::numeric / (count(*) - 1)) *
                 sum(power(c.t_c - (max(ca.t_tot) / max(ca.n_tot)) * c.n_c, 2))
               ) / max(ca.n_tot)
             ELSE NULL::numeric
           END AS se_r
      FROM _fl_clus c
      JOIN ca USING (manifest_hash, strategy_version, slice_dim, slice_key, gate, arm)
     GROUP BY 1,2,3,4,5,6
  )
  INSERT INTO filter_lift_stats (
    manifest_hash, strategy_version, gate, arm, plan_origin, run_id,
    slice_dim, slice_key,
    n_candidates, n_mature, n_resolved, n_used, replay_coverage,
    mean_r, sd_r, se_r, cluster_n, stat_status, reason,
    terminal_replay_horizon_hours, computed_as_of)
  SELECT a.manifest_hash, a.strategy_version, a.gate, a.arm,
         'common_counterfactual_ladder_v1', this_run,
         a.slice_dim, a.slice_key,
         a.n_candidates, a.n_mature, a.n_resolved, a.n_used,
         CASE WHEN a.n_mature = 0 THEN NULL
              ELSE round(a.n_resolved::numeric / a.n_mature, 6) END,
         round(a.mean_r, 6), round(a.sd_r, 6),
         round(se.se_r, 6),
         ca.cluster_n,
         CASE
           WHEN a.n_used = 0 THEN 'unavailable'
           WHEN a.n_mature = 0 OR a.n_resolved::numeric / a.n_mature < 0.95
             THEN 'insufficient_coverage'
           WHEN a.n_used < 30 THEN 'insufficient_sample'
           WHEN ca.cluster_n < 10 THEN 'insufficient_clusters'
           WHEN se.se_r IS NULL THEN 'insufficient_clusters'
           ELSE 'descriptive'
         END,
         CASE
           WHEN a.n_used = 0 THEN 'no mature resolved research-ladder plans for this arm'
           WHEN a.n_mature = 0 OR a.n_resolved::numeric / a.n_mature < 0.95
             THEN 'replay coverage below 0.95: unresolved mature plans could still change the mean'
           WHEN a.n_used < 30 THEN 'fewer than 30 observations in this arm'
           WHEN ca.cluster_n < 10
             THEN 'fewer than 10 instrument-days: overlapping plans are not independent'
           WHEN se.se_r IS NULL THEN 'fewer than 2 usable clusters: no cluster-robust interval'
           ELSE 'descriptive diagnostic under one common research ladder; cluster-robust interval, no causal claim'
         END,
         hz, as_of
    FROM agg a
    JOIN ca USING (manifest_hash, strategy_version, slice_dim, slice_key, gate, arm)
    LEFT JOIN se USING (manifest_hash, strategy_version, slice_dim, slice_key, gate, arm);

  SELECT count(*) INTO out_rows FROM filter_lift_stats;

  RETURN jsonb_build_object(
    'cohort', 'research_candidate',
    'replay_version', 1,
    'execution_policy', 'legacy_best_target_touched',
    'plan_ladder', 'common_counterfactual_ladder_v1',
    'grouping', 'manifest_hash|slice_dim|slice_key|gate|arm',
    'inference', 'cluster_robust_descriptive',
    'terminal_replay_horizon_hours', hz,
    'computed_as_of', as_of,
    'run_id', this_run,
    'rows', out_rows
  );
END;
$function$;

-- 5. Propose a gate change. Refused unless the evidence is decidable for this gate.
CREATE OR REPLACE FUNCTION public.propose_gate_change(
  _gate text,
  _proposed_value numeric,
  _reason text,
  _actor text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record;
  f record;
  v_verdict text;
  v_current numeric;
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _gate NOT IN ('risk_ceiling','headroom','reachable_r') THEN
    RAISE EXCEPTION 'gate % is not threshold-tunable', _gate;
  END IF;
  IF _proposed_value IS NULL OR _proposed_value <= 0 THEN
    RAISE EXCEPTION 'proposed value must be positive';
  END IF;
  IF coalesce(btrim(_reason), '') = '' OR coalesce(btrim(_actor), '') = '' THEN
    RAISE EXCEPTION 'a proposal requires a named actor and a reason';
  END IF;
  IF EXISTS (SELECT 1 FROM gate_change_proposals WHERE gate = _gate AND status = 'proposed') THEN
    RAISE EXCEPTION 'an open proposal already exists for gate %', _gate;
  END IF;

  -- Dominant manifest for this gate: the evaluation population with the most
  -- candidates, so an overridden-policy cohort can never masquerade as the
  -- original one.
  SELECT s.manifest_hash INTO p
    FROM filter_lift_stats s
   WHERE s.gate = _gate AND s.slice_dim = 'global'
   GROUP BY s.manifest_hash
   ORDER BY sum(s.n_candidates) DESC NULLS LAST
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no filter-lift statistics recorded for gate % yet', _gate;
  END IF;

  SELECT * INTO p FROM filter_lift_stats
   WHERE gate = _gate AND slice_dim = 'global' AND arm = 'pass'
     AND manifest_hash = (SELECT s.manifest_hash FROM filter_lift_stats s
                           WHERE s.gate = _gate AND s.slice_dim = 'global'
                           GROUP BY s.manifest_hash ORDER BY sum(s.n_candidates) DESC LIMIT 1);
  SELECT * INTO f FROM filter_lift_stats
   WHERE gate = _gate AND slice_dim = 'global' AND arm = 'fail'
     AND manifest_hash = p.manifest_hash;

  IF p.stat_status IS DISTINCT FROM 'descriptive' OR f.stat_status IS DISTINCT FROM 'descriptive'
     OR p.n_used < 30 OR f.n_used < 30 OR p.se_r IS NULL OR f.se_r IS NULL THEN
    RAISE EXCEPTION 'gate % is not yet decidable: pass=% (%), fail=% (%)',
      _gate, p.stat_status, coalesce(p.reason,'no rows'), f.stat_status, coalesce(f.reason,'no rows');
  END IF;

  IF f.mean_r - 1.96 * f.se_r > p.mean_r + 1.96 * p.se_r THEN
    v_verdict := 'loosening_supported';
  ELSIF p.mean_r - 1.96 * p.se_r > f.mean_r + 1.96 * f.se_r THEN
    v_verdict := 'gate_supported';
  ELSE
    RAISE EXCEPTION 'the two arms'' intervals overlap — no difference is readable for gate %', _gate;
  END IF;

  SELECT o.value INTO v_current FROM gate_threshold_overrides o WHERE o.gate = _gate;
  IF v_current IS NOT NULL AND v_current = _proposed_value THEN
    RAISE EXCEPTION 'proposed value % is already the active override for gate %', _proposed_value, _gate;
  END IF;

  INSERT INTO gate_change_proposals (
    gate, current_value, proposed_value, stats_snapshot, verdict, proposed_by, decision_reason
  ) VALUES (
    _gate, v_current, _proposed_value,
    jsonb_build_object(
      'as_of', now(),
      'manifest_hash', p.manifest_hash,
      'pass', jsonb_build_object('mean_r', p.mean_r, 'se_r', p.se_r, 'n_used', p.n_used, 'cluster_n', p.cluster_n),
      'fail', jsonb_build_object('mean_r', f.mean_r, 'se_r', f.se_r, 'n_used', f.n_used, 'cluster_n', f.cluster_n)
    ),
    v_verdict, _actor, _reason
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'verdict', v_verdict, 'current_value', v_current);
END;
$function$;

-- 6. Decide on a proposal. Approval writes the override plus an audit row;
--    nothing else in the system can write gate_threshold_overrides.
CREATE OR REPLACE FUNCTION public.decide_gate_change(
  _id uuid,
  _decision text,
  _reason text,
  _actor text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  prop gate_change_proposals%ROWTYPE;
  v_old jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _decision NOT IN ('approved','rejected','reverted') THEN
    RAISE EXCEPTION 'unknown decision %', _decision;
  END IF;
  IF coalesce(btrim(_reason), '') = '' OR coalesce(btrim(_actor), '') = '' THEN
    RAISE EXCEPTION 'a decision requires a named actor and a reason';
  END IF;

  SELECT * INTO prop FROM gate_change_proposals WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal % not found', _id; END IF;

  IF _decision IN ('approved','rejected') AND prop.status <> 'proposed' THEN
    RAISE EXCEPTION 'proposal % is %, not proposed', _id, prop.status;
  END IF;
  IF _decision = 'reverted' AND prop.status <> 'approved' THEN
    RAISE EXCEPTION 'proposal % is %, not approved — nothing to revert', _id, prop.status;
  END IF;

  SELECT to_jsonb(o) INTO v_old FROM gate_threshold_overrides o WHERE o.gate = prop.gate;

  IF _decision = 'approved' THEN
    INSERT INTO gate_threshold_overrides (gate, value, set_by, reason, proposal_id, updated_at)
    VALUES (prop.gate, prop.proposed_value, _actor, _reason, prop.id, now())
    ON CONFLICT (gate) DO UPDATE
      SET value = EXCLUDED.value, set_by = EXCLUDED.set_by, reason = EXCLUDED.reason,
          proposal_id = EXCLUDED.proposal_id, updated_at = now();

    INSERT INTO execution_control_changes (changed_by, reason, control_key, old_value, new_value, evidence)
    VALUES (_actor, _reason, 'gate.' || prop.gate, v_old,
            jsonb_build_object('gate', prop.gate, 'value', prop.proposed_value),
            jsonb_build_object('proposal_id', prop.id, 'stats_snapshot', prop.stats_snapshot));

    UPDATE gate_change_proposals
       SET status = 'approved', decided_by = _actor, decision_reason = _reason,
           decided_at = now(), applied_at = now()
     WHERE id = prop.id;

  ELSIF _decision = 'rejected' THEN
    UPDATE gate_change_proposals
       SET status = 'rejected', decided_by = _actor, decision_reason = _reason, decided_at = now()
     WHERE id = prop.id;

  ELSE -- reverted
    IF prop.current_value IS NULL THEN
      DELETE FROM gate_threshold_overrides WHERE gate = prop.gate;
    ELSE
      INSERT INTO gate_threshold_overrides (gate, value, set_by, reason, proposal_id, updated_at)
      VALUES (prop.gate, prop.current_value, _actor, _reason, prop.id, now())
      ON CONFLICT (gate) DO UPDATE
        SET value = EXCLUDED.value, set_by = EXCLUDED.set_by, reason = EXCLUDED.reason,
            proposal_id = EXCLUDED.proposal_id, updated_at = now();
    END IF;

    INSERT INTO execution_control_changes (changed_by, reason, control_key, old_value, new_value, evidence)
    VALUES (_actor, _reason, 'gate.' || prop.gate, v_old,
            CASE WHEN prop.current_value IS NULL THEN NULL::jsonb
                 ELSE jsonb_build_object('gate', prop.gate, 'value', prop.current_value) END,
            jsonb_build_object('proposal_id', prop.id, 'reverted', true));

    UPDATE gate_change_proposals
       SET status = 'reverted', decided_by = _actor, decision_reason = _reason,
           decided_at = now(), reverted_at = now()
     WHERE id = prop.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', prop.id, 'status', _decision);
END;
$function$;

-- 7. Combined owner-only learning evidence read: global rows, slice rows,
--    proposals, active overrides, and post-change verification cohorts.
CREATE OR REPLACE FUNCTION public.get_admin_learning_evidence()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5000ms'
AS $function$
DECLARE
  v jsonb;
  v_post jsonb := '[]'::jsonb;
  prop record;
  cohort jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Post-change verification: for each approved (not reverted) proposal, the
  -- same-gate cohort detected AFTER the change point, per arm.
  FOR prop IN
    SELECT id, gate, applied_at FROM gate_change_proposals
     WHERE status = 'approved' AND applied_at IS NOT NULL
  LOOP
    SELECT jsonb_build_object(
      'proposal_id', prop.id,
      'gate', prop.gate,
      'applied_at', prop.applied_at,
      'arms', coalesce(jsonb_agg(jsonb_build_object(
        'arm', arm, 'n_used', n_used, 'mean_r', mean_r, 'cluster_n', cluster_n
      ) ORDER BY arm), '[]'::jsonb)
    ) INTO cohort
    FROM (
      SELECT g->>'outcome' AS arm,
             count(*) FILTER (WHERE se.status = 'resolved'
                              AND se.realized_r IS NOT NULL
                              AND coalesce(se.data_quality_outcome,'') <> 'invalid_plan') AS n_used,
             round(avg(CASE WHEN se.resolved_outcome = 'never_filled'
                                 OR se.data_quality_outcome = 'gap_beyond_stop'
                            THEN 0::numeric ELSE se.realized_r::numeric END)
                   FILTER (WHERE se.status = 'resolved'), 6) AS mean_r,
             count(DISTINCT date_trunc('day', se.detected_at)::date::text || '|' || se.instrument)
               FILTER (WHERE se.status = 'resolved') AS cluster_n
        FROM research_candidates c
        JOIN shadow_executions se
          ON se.research_candidate_id = c.id
         AND se.cohort = 'research_candidate'
         AND se.plan_origin = 'counterfactual'
         AND se.replay_version = 1
         AND se.execution_policy = 'legacy_best_target_touched'
        CROSS JOIN LATERAL jsonb_array_elements(c.gates) g
       WHERE c.gates_complete
         AND c.cf_plan_version IS NOT NULL
         AND g->>'gate' = prop.gate
         AND g->>'outcome' IN ('pass','fail')
         AND se.detected_at > prop.applied_at
       GROUP BY 1
    ) arms;

    IF cohort IS NOT NULL THEN
      v_post := v_post || cohort;
    END IF;
  END LOOP;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.slice_dim, f.slice_key, f.gate, f.arm)
                        FROM filter_lift_stats f), '[]'::jsonb),
    'proposals', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC)
                             FROM (SELECT * FROM gate_change_proposals ORDER BY created_at DESC LIMIT 50) p), '[]'::jsonb),
    'overrides', coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.gate)
                             FROM gate_threshold_overrides o), '[]'::jsonb),
    'post_change', v_post
  ) INTO v;

  RETURN v;
END;
$function$;