ALTER TABLE public.broker_trade_evidence
  ADD COLUMN IF NOT EXISTS signal_grade_source text,
  ADD COLUMN IF NOT EXISTS signal_first_decision_at timestamptz;

CREATE OR REPLACE FUNCTION public.enforce_evidence_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ignored text[] := ARRAY[
    'published_entry', 'slippage_price', 'slippage_availability', 'slippage_basis', 'updated_at',
    'signal_id', 'signal_instrument', 'signal_grade', 'signal_grade_source', 'signal_first_decision_at'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'broker_trade_evidence rows are immutable evidence and cannot be deleted';
  END IF;
  IF OLD.state = 'closed' THEN
    -- Closed evidence stays immutable. The only exceptions are one-time fills of
    -- the slippage fields and of characterisation fields that are still unset.
    IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
      RAISE EXCEPTION 'closed broker evidence is immutable';
    END IF;
    IF OLD.slippage_price IS NOT NULL AND NEW.slippage_price IS DISTINCT FROM OLD.slippage_price THEN
      RAISE EXCEPTION 'closed broker evidence slippage is already recorded and immutable';
    END IF;
    IF OLD.signal_id IS NOT NULL AND NEW.signal_id IS DISTINCT FROM OLD.signal_id THEN
      RAISE EXCEPTION 'closed broker evidence signal link is already recorded and immutable';
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
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;