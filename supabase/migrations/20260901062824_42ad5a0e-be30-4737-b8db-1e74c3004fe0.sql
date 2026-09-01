ALTER TABLE public.broker_trade_evidence
  ADD COLUMN IF NOT EXISTS signal_instrument text,
  ADD COLUMN IF NOT EXISTS signal_grade text,
  ADD COLUMN IF NOT EXISTS signal_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS signal_trading_session text,
  ADD COLUMN IF NOT EXISTS signal_time_of_day smallint,
  ADD COLUMN IF NOT EXISTS signal_day_of_week smallint;