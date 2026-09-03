ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS research_window_status text;

COMMENT ON COLUMN public.shadow_executions.research_window_status IS
  'Research-cohort only. ''outside_replay_window'' means the row''s detection time is further back than the maximum replay candle depth can reach, so it can never be resolved from available candles. NULL means no such determination.';

CREATE OR REPLACE FUNCTION public.get_admin_candidate_funnel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5000ms'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'flags', (SELECT to_jsonb(f) FROM (
        SELECT candidate_capture_enabled, candidate_enrolment_enabled, candidate_rows_per_run,
               research_errors, research_last_error, research_last_error_at
          FROM shadow_engine_state LIMIT 1) f),
    'totals', (SELECT to_jsonb(t) FROM (
        SELECT count(*) AS n,
               count(*) FILTER (WHERE detected_at > now() - interval '24 hours') AS n_24h,
               count(*) FILTER (WHERE terminal_stage = 'published') AS published,
               count(*) FILTER (WHERE entry_price IS NOT NULL) AS with_geometry,
               count(*) FILTER (WHERE NOT gates_complete) AS gates_incomplete,
               count(*) FILTER (WHERE enrolled_plan_id IS NOT NULL) AS enrolled,
               count(*) FILTER (WHERE enrolled_plan_id IS NULL AND entry_price IS NOT NULL)
                 AS enrolment_backlog,
               count(*) FILTER (WHERE enrolled_plan_id IS NULL AND cf_plan_version IS NOT NULL)
                 AS enrolable_backlog,
               min(detected_at) FILTER (WHERE enrolled_plan_id IS NULL AND cf_plan_version IS NOT NULL)
                 AS oldest_unenrolled_at,
               min(enrolled_at) AS first_enrolled_at,
               max(enrolled_at) AS last_enrolled_at,
               min(detected_at) FILTER (WHERE enrolled_plan_id IS NOT NULL)
                 AS oldest_enrolled_detected_at,
               min(detected_at) AS first_seen,
               max(detected_at) AS last_seen
          FROM research_candidates) t),
    'outside_replay_window', (SELECT count(*) FROM shadow_executions
        WHERE cohort = 'research_candidate'
          AND research_window_status = 'outside_replay_window'),
    'enrolled_by_day', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day DESC) FROM (
        SELECT to_char(date_trunc('day', enrolled_at), 'YYYY-MM-DD') AS day,
               count(*) AS n,
               min(detected_at) AS oldest_detected_at
          FROM research_candidates
         WHERE enrolled_at IS NOT NULL
         GROUP BY 1
         ORDER BY 1 DESC
         LIMIT 14) d), '[]'::jsonb),
    'by_stage', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.n DESC) FROM (
        SELECT terminal_stage, count(*) AS n,
               count(*) FILTER (WHERE entry_price IS NOT NULL) AS with_geometry
          FROM research_candidates GROUP BY terminal_stage) s), '[]'::jsonb),
    'by_instrument', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.instrument) FROM (
        SELECT instrument, direction, count(*) AS n
          FROM research_candidates GROUP BY instrument, direction) i), '[]'::jsonb),
    'gate_outcomes', coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.gate) FROM (
        SELECT e->>'gate' AS gate,
               count(*) FILTER (WHERE e->>'outcome' = 'pass') AS pass,
               count(*) FILTER (WHERE e->>'outcome' = 'fail') AS fail,
               count(*) FILTER (WHERE e->>'outcome' = 'not_evaluable') AS not_evaluable
          FROM research_candidates c, jsonb_array_elements(c.gates) e
         GROUP BY e->>'gate') g), '[]'::jsonb),
    'by_plan_origin', coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.plan_origin) FROM (
        SELECT coalesce(plan_origin, 'none') AS plan_origin,
               count(*) AS n,
               count(*) FILTER (WHERE enrolled_plan_id IS NOT NULL) AS enrolled
          FROM research_candidates GROUP BY 1) o), '[]'::jsonb),
    'cohort_counts', coalesce((SELECT jsonb_object_agg(cohort, n) FROM (
        SELECT cohort, count(*) AS n FROM shadow_executions GROUP BY cohort) x), '{}'::jsonb)
  ) INTO v;

  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_admin_candidate_funnel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_candidate_funnel() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_candidate_lineage(
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5000ms'
AS $function$
DECLARE
  v jsonb;
  _lim integer := least(greatest(coalesce(_limit, 50), 1), 200);
  _off integer := greatest(coalesce(_offset, 0), 0);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'limit', _lim,
    'offset', _off,
    'total_enrolled', (SELECT count(*) FROM research_candidates WHERE enrolled_plan_id IS NOT NULL),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.enrolled_at DESC NULLS LAST, r.detected_at DESC)
      FROM (
        SELECT c.id AS candidate_id,
               c.instrument,
               c.direction,
               c.detected_at,
               c.enrolled_at,
               c.enrolled_plan_id,
               c.terminal_stage,
               c.grade AS published_grade,
               c.cf_grade AS research_grade,
               c.counterfactual_stage AS rejected_by_gate,
               c.published_signal_id,
               -- Replay outcome from the research cohort execution.
               se.status AS replay_status,
               se.filled_at AS replay_filled_at,
               se.realized_r AS replay_realized_r,
               se.max_target_touched AS replay_max_target_touched,
               se.resolved_outcome AS replay_outcome,
               se.resolved_at AS replay_resolved_at,
               se.research_window_status,
               -- Automatic-order decision, only ever present for a published signal.
               d.decision AS enqueue_decision,
               d.reason AS enqueue_reason,
               d.decided_at AS enqueue_decided_at,
               -- Broker truth, only ever present for an order that actually existed.
               ev.state AS broker_state,
               ev.gross_profit AS broker_gross_profit,
               ev.swap AS broker_swap,
               ev.commission AS broker_commission,
               ev.profit_currency AS broker_profit_currency,
               ev.r_vs_plan AS broker_r_vs_plan
          FROM research_candidates c
          LEFT JOIN shadow_executions se
                 ON se.research_candidate_id = c.id
                AND se.cohort = 'research_candidate'
          LEFT JOIN LATERAL (
                 SELECT x.decision, x.reason, x.decided_at
                   FROM execution_enqueue_decisions x
                  WHERE c.published_signal_id IS NOT NULL
                    AND x.signal_id = c.published_signal_id
                  ORDER BY x.decided_at DESC
                  LIMIT 1) d ON true
          LEFT JOIN LATERAL (
                 SELECT y.state, y.gross_profit, y.swap, y.commission,
                        y.profit_currency, y.r_vs_plan
                   FROM broker_trade_evidence y
                  WHERE c.published_signal_id IS NOT NULL
                    AND (y.signal_id = c.published_signal_id
                         OR y.signal_ref = c.published_signal_id)
                  ORDER BY y.updated_at DESC NULLS LAST
                  LIMIT 1) ev ON true
         WHERE c.enrolled_plan_id IS NOT NULL
         ORDER BY c.enrolled_at DESC NULLS LAST, c.detected_at DESC
         LIMIT _lim OFFSET _off
      ) r), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_candidate_lineage(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_candidate_lineage(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_candidate_lineage(integer, integer) TO authenticated, service_role;