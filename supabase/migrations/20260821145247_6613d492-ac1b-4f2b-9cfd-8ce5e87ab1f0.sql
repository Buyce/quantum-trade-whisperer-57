-- Stage 3: research candidate capture (dark, admin-visible aggregates only).
CREATE TABLE IF NOT EXISTS public.research_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid,
  observation_key text,
  instrument text NOT NULL,
  direction text,
  strategy_version smallint NOT NULL DEFAULT 1,
  manifest_hash text NOT NULL,
  code_hash text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  trading_session text,
  volatility_index numeric,
  -- Terminal evaluation stage. 'published' means every gate passed.
  terminal_stage text NOT NULL,
  v1_decision text NOT NULL,
  gates jsonb NOT NULL DEFAULT '[]'::jsonb,
  gates_complete boolean NOT NULL DEFAULT true,
  features jsonb,
  -- Proposed geometry. NULL whenever it could not be derived. Never fabricated.
  grade text,
  structure_key text,
  entry_price numeric,
  stop_loss numeric,
  tp1 numeric,
  tp2 numeric,
  tp3 numeric,
  tp1_r numeric,
  tp2_r numeric,
  tp3_r numeric,
  max_r numeric,
  risk_price numeric,
  atr numeric,
  confidence_score numeric,
  published_signal_id uuid REFERENCES public.scanned_signals(id) ON DELETE SET NULL,
  enrolled_plan_id uuid,
  enrolled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_candidates_direction_check
    CHECK (direction IS NULL OR direction IN ('long', 'short'))
);

CREATE UNIQUE INDEX IF NOT EXISTS research_candidates_identity
  ON public.research_candidates (run_id, instrument, direction, strategy_version)
  WHERE run_id IS NOT NULL AND direction IS NOT NULL;
CREATE INDEX IF NOT EXISTS research_candidates_stage
  ON public.research_candidates (terminal_stage, detected_at DESC);
CREATE INDEX IF NOT EXISTS research_candidates_unenrolled
  ON public.research_candidates (detected_at) WHERE enrolled_plan_id IS NULL;

GRANT ALL ON public.research_candidates TO service_role;
ALTER TABLE public.research_candidates ENABLE ROW LEVEL SECURITY;

-- Candidate -> execution provenance.
ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS research_candidate_id uuid REFERENCES public.research_candidates(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.get_admin_candidate_funnel()
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
               min(detected_at) AS first_seen,
               max(detected_at) AS last_seen
          FROM research_candidates) t),
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
    'cohort_counts', coalesce((SELECT jsonb_object_agg(cohort, n) FROM (
        SELECT cohort, count(*) AS n FROM shadow_executions GROUP BY cohort) x), '{}'::jsonb)
  ) INTO v;

  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_admin_candidate_funnel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_candidate_funnel() TO authenticated;