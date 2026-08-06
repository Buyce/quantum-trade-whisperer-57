ALTER TABLE public.scanned_signals
  ADD COLUMN IF NOT EXISTS p_trend numeric,
  ADD COLUMN IF NOT EXISTS p_order_block numeric,
  ADD COLUMN IF NOT EXISTS p_momentum numeric,
  ADD COLUMN IF NOT EXISTS p_volatility_expansion numeric,
  ADD COLUMN IF NOT EXISTS pillars_passed integer;