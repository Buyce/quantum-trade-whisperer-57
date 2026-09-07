ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS auto_exit_policy text NOT NULL DEFAULT 'single_exit_first_target';

ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_auto_exit_policy_check;
ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_auto_exit_policy_check CHECK (
    auto_exit_policy = ANY (ARRAY[
      'single_exit_first_target'::text,
      'single_exit_second_target'::text,
      'single_exit_third_target'::text,
      'partial_tp1_runner_tp2'::text
    ])
  );

ALTER TABLE public.execution_controls
  DROP CONSTRAINT IF EXISTS execution_controls_execution_policy_check;
ALTER TABLE public.execution_controls
  ADD CONSTRAINT execution_controls_execution_policy_check CHECK (
    execution_policy = ANY (ARRAY[
      'single_exit_first_target'::text,
      'single_exit_second_target'::text,
      'single_exit_third_target'::text,
      'partial_tp1_runner_tp2'::text
    ])
  );

ALTER TABLE public.broker_trade_evidence
  ADD COLUMN IF NOT EXISTS execution_policy text,
  ADD COLUMN IF NOT EXISTS target_rank smallint,
  ADD COLUMN IF NOT EXISTS managed_exit boolean NOT NULL DEFAULT false;

ALTER TABLE public.broker_trade_evidence
  DROP CONSTRAINT IF EXISTS broker_trade_evidence_target_rank_check;
ALTER TABLE public.broker_trade_evidence
  ADD CONSTRAINT broker_trade_evidence_target_rank_check CHECK (
    target_rank IS NULL OR (target_rank >= 1 AND target_rank <= 3)
  );

CREATE OR REPLACE FUNCTION public.enforce_evidence_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  ignored text[] := ARRAY[
    'published_entry', 'slippage_price', 'slippage_availability', 'slippage_basis', 'updated_at',
    'signal_id', 'signal_ref', 'signal_instrument', 'signal_grade', 'signal_grade_source',
    'signal_first_decision_at', 'execution_policy', 'target_rank', 'managed_exit'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'broker_trade_evidence rows are immutable evidence and cannot be deleted';
  END IF;
  IF OLD.state = 'closed' THEN
    IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
      RAISE EXCEPTION 'closed broker evidence is immutable';
    END IF;
    IF OLD.slippage_price IS NOT NULL AND NEW.slippage_price IS DISTINCT FROM OLD.slippage_price THEN
      RAISE EXCEPTION 'closed broker evidence slippage is already recorded and immutable';
    END IF;
    IF OLD.signal_id IS NOT NULL AND NEW.signal_id IS DISTINCT FROM OLD.signal_id THEN
      RAISE EXCEPTION 'closed broker evidence signal link is already recorded and immutable';
    END IF;
    IF OLD.signal_ref IS NOT NULL AND NEW.signal_ref IS DISTINCT FROM OLD.signal_ref THEN
      RAISE EXCEPTION 'closed broker evidence recovered signal reference is already recorded and immutable';
    END IF;
    IF OLD.signal_instrument IS NOT NULL AND NEW.signal_instrument IS DISTINCT FROM OLD.signal_instrument THEN
      RAISE EXCEPTION 'closed broker evidence instrument is already recorded and immutable';
    END IF;
    IF OLD.signal_grade IS NOT NULL AND NEW.signal_grade IS DISTINCT FROM OLD.signal_grade THEN
      RAISE EXCEPTION 'closed broker evidence grade is already recorded and immutable';
    END IF;
    IF OLD.signal_grade_source IS NOT NULL AND NEW.signal_grade_source IS DISTINCT FROM OLD.signal_grade_source THEN
      RAISE EXCEPTION 'closed broker evidence grade source is already recorded and immutable';
    END IF;
    IF OLD.signal_first_decision_at IS NOT NULL AND NEW.signal_first_decision_at IS DISTINCT FROM OLD.signal_first_decision_at THEN
      RAISE EXCEPTION 'closed broker evidence first-decision time is already recorded and immutable';
    END IF;
    IF OLD.execution_policy IS NOT NULL AND NEW.execution_policy IS DISTINCT FROM OLD.execution_policy THEN
      RAISE EXCEPTION 'closed broker evidence exit policy is already recorded and immutable';
    END IF;
    IF OLD.target_rank IS NOT NULL AND NEW.target_rank IS DISTINCT FROM OLD.target_rank THEN
      RAISE EXCEPTION 'closed broker evidence target rank is already recorded and immutable';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.position_management_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  delivery_id bigint NOT NULL REFERENCES public.execution_deliveries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.connected_trading_accounts(id) ON DELETE CASCADE,
  broker_position_id text NOT NULL,
  execution_policy text NOT NULL,
  account_mode text NOT NULL,
  partial_volume numeric,
  partial_state text NOT NULL DEFAULT 'pending',
  partial_attempted_at timestamptz,
  partial_confirmed_at timestamptz,
  partial_detail text,
  stop_move_state text NOT NULL DEFAULT 'pending',
  stop_move_target numeric,
  stop_move_attempted_at timestamptz,
  stop_move_confirmed_at timestamptz,
  stop_move_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT position_management_state_position_key UNIQUE (account_id, broker_position_id),
  CONSTRAINT position_management_partial_state_check CHECK (
    partial_state = ANY (ARRAY['pending'::text,'attempted'::text,'confirmed'::text,'refused'::text,'unknown'::text,'not_applicable'::text])
  ),
  CONSTRAINT position_management_stop_state_check CHECK (
    stop_move_state = ANY (ARRAY['pending'::text,'attempted'::text,'confirmed'::text,'refused'::text,'unknown'::text,'not_applicable'::text])
  )
);

GRANT SELECT ON public.position_management_state TO authenticated;
GRANT ALL ON public.position_management_state TO service_role;

ALTER TABLE public.position_management_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their own position management" ON public.position_management_state
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS position_management_state_open_idx
  ON public.position_management_state (partial_state, stop_move_state);

CREATE TRIGGER position_management_state_touch
  BEFORE UPDATE ON public.position_management_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();