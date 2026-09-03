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
               -- The decision table records its refusal text in `detail` and its
               -- timestamp in `created_at`; there is no `reason`/`decided_at`.
               d.decision AS enqueue_decision,
               d.detail AS enqueue_reason,
               d.created_at AS enqueue_decided_at,
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
                 SELECT x.decision, x.detail, x.created_at
                   FROM execution_enqueue_decisions x
                  WHERE c.published_signal_id IS NOT NULL
                    AND x.signal_id = c.published_signal_id
                  ORDER BY x.created_at DESC
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