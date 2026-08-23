-- Prompt 14 closure: retain the plan identity needed by broker Performance
-- after scanned_signals leaves its short production retention window.
-- Existing closed evidence stays immutable; the application can use the live
-- signal relation while it remains retained, and all newly observed evidence
-- receives these snapshots at first write.
ALTER TABLE public.broker_trade_evidence
  ADD COLUMN IF NOT EXISTS signal_instrument text,
  ADD COLUMN IF NOT EXISTS signal_grade text,
  ADD COLUMN IF NOT EXISTS signal_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS signal_trading_session text,
  ADD COLUMN IF NOT EXISTS signal_time_of_day integer,
  ADD COLUMN IF NOT EXISTS signal_day_of_week integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broker_evidence_signal_grade_chk'
  ) THEN
    ALTER TABLE public.broker_trade_evidence
      ADD CONSTRAINT broker_evidence_signal_grade_chk
      CHECK (signal_grade IS NULL OR signal_grade IN ('A+', 'A', 'B', 'C'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broker_evidence_signal_hour_chk'
  ) THEN
    ALTER TABLE public.broker_trade_evidence
      ADD CONSTRAINT broker_evidence_signal_hour_chk
      CHECK (signal_time_of_day IS NULL OR signal_time_of_day BETWEEN 0 AND 23);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broker_evidence_signal_day_chk'
  ) THEN
    ALTER TABLE public.broker_trade_evidence
      ADD CONSTRAINT broker_evidence_signal_day_chk
      CHECK (signal_day_of_week IS NULL OR signal_day_of_week BETWEEN 0 AND 6);
  END IF;
END $$;

-- Open rows are still mutable evidence, so snapshot what is currently retained.
-- Closed rows are deliberately untouched: their immutability trigger remains on.
UPDATE public.broker_trade_evidence AS evidence
   SET signal_instrument = signal.instrument,
       signal_grade = signal.grade::text,
       signal_detected_at = signal.detected_at,
       signal_trading_session = context.trading_session,
       signal_time_of_day = context.time_of_day,
       signal_day_of_week = context.day_of_week
  FROM public.scanned_signals AS signal
  LEFT JOIN public.market_context AS context ON context.signal_id = signal.id
 WHERE evidence.state = 'open'
   AND evidence.signal_id = signal.id;
