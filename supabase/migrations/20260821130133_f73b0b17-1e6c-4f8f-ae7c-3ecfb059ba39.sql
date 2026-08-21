-- === Replay identity: plan_id / replay_version / execution_policy ===
ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS replay_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS execution_policy text NOT NULL DEFAULT 'legacy_best_target_touched',
  ADD COLUMN IF NOT EXISTS risk_price_actual numeric,
  ADD COLUMN IF NOT EXISTS gross_r numeric,
  ADD COLUMN IF NOT EXISTS net_r numeric,
  ADD COLUMN IF NOT EXISTS fill_bar_time timestamptz,
  ADD COLUMN IF NOT EXISTS fill_gap_through boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stop_gap_through boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fill_ambiguous_tif boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fill_bar_excursion_ambiguous boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ambiguous_bars integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ambiguous_bar_target_touch smallint,
  ADD COLUMN IF NOT EXISTS adjudication text,
  ADD COLUMN IF NOT EXISTS tp1_before_stop boolean,
  ADD COLUMN IF NOT EXISTS stop_before_tp1 boolean,
  ADD COLUMN IF NOT EXISTS first_target_touched smallint,
  ADD COLUMN IF NOT EXISTS max_target_touched smallint,
  ADD COLUMN IF NOT EXISTS data_quality_outcome text;

-- Existing rows are their own plan: identity is stable and Replay-V1 keeps them.
UPDATE public.shadow_executions SET plan_id = id WHERE plan_id IS NULL;
ALTER TABLE public.shadow_executions ALTER COLUMN plan_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.shadow_executions ALTER COLUMN plan_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shadow_executions_plan_replay_policy_key
  ON public.shadow_executions (plan_id, replay_version, execution_policy);

CREATE INDEX IF NOT EXISTS shadow_executions_replay_status_idx
  ON public.shadow_executions (replay_version, status, model_version, detected_at);

-- === Replay version registry ===
CREATE TABLE IF NOT EXISTS public.replay_versions (
  version smallint PRIMARY KEY,
  label text NOT NULL,
  semantics jsonb NOT NULL,
  code_hash text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);
GRANT SELECT ON public.replay_versions TO authenticated;
GRANT ALL ON public.replay_versions TO service_role;
ALTER TABLE public.replay_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "replay_versions readable by admin" ON public.replay_versions;
CREATE POLICY "replay_versions readable by admin" ON public.replay_versions
  FOR SELECT TO authenticated USING (public.is_admin());

-- === Runtime switches ===
ALTER TABLE public.shadow_engine_state
  ADD COLUMN IF NOT EXISTS active_replay_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS replay_v2_shadow_enabled boolean NOT NULL DEFAULT false;

-- === Fail-open sibling creation ===
-- A research sibling clones the IMMUTABLE PLAN ONLY, with a clean execution
-- state. Any failure here is swallowed: research must never roll back the
-- production enrolment that triggered it.
CREATE OR REPLACE FUNCTION public.create_replay_v2_sibling()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF NEW.replay_version <> 1 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT replay_v2_shadow_enabled INTO v_enabled FROM public.shadow_engine_state WHERE id;
    IF COALESCE(v_enabled, false) = false THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.shadow_executions (
      plan_id, replay_version, execution_policy,
      signal_id, instrument, grade, direction, detected_at,
      entry_price, stop_loss, tp1, tp2, tp3,
      tp1_r, tp2_r, tp3_r, max_r, risk_price, atr,
      confidence_score, trading_session, volatility_index,
      model_version, observation_key, strategy_family, quality_grade,
      entry_source, stop_anchor,
      status, replay_cursor, bars_replayed
    ) VALUES (
      NEW.plan_id, 2, 'single_exit_first_target',
      NEW.signal_id, NEW.instrument, NEW.grade, NEW.direction, NEW.detected_at,
      NEW.entry_price, NEW.stop_loss, NEW.tp1, NEW.tp2, NEW.tp3,
      NEW.tp1_r, NEW.tp2_r, NEW.tp3_r, NEW.max_r, NEW.risk_price, NEW.atr,
      NEW.confidence_score, NEW.trading_session, NEW.volatility_index,
      NEW.model_version, NEW.observation_key, NEW.strategy_family, NEW.quality_grade,
      NEW.entry_source, NEW.stop_anchor,
      'pending', NEW.detected_at, 0
    )
    ON CONFLICT (plan_id, replay_version, execution_policy) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.shadow_engine_state
       SET research_errors = research_errors + 1,
           research_last_error = left('replay v2 sibling failed: ' || SQLERRM, 500),
           research_last_error_at = now(),
           updated_at = now()
     WHERE id;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shadow_executions_replay_v2_sibling ON public.shadow_executions;
CREATE TRIGGER shadow_executions_replay_v2_sibling
AFTER INSERT ON public.shadow_executions
FOR EACH ROW EXECUTE FUNCTION public.create_replay_v2_sibling();

-- === Seed the registry ===
INSERT INTO public.replay_versions (version, label, code_hash, semantics)
VALUES
  (1, 'legacy_m15_optimistic', 'b1bc0ac96d59dec4', '{"registered_by":"prompt-5g","frozen":true}'::jsonb),
  (2, 'm15_fail_closed_actual_risk', '270450b8cc142a73', '{"registered_by":"prompt-5g","research_only":true}'::jsonb)
ON CONFLICT (version) DO NOTHING;