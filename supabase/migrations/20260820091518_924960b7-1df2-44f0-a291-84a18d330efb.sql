ALTER TABLE public.executed_trades
  ADD COLUMN IF NOT EXISTS actual_entry_price numeric,
  ADD COLUMN IF NOT EXISTS actual_exit_price numeric,
  ADD COLUMN IF NOT EXISTS derived_r numeric;

COMMENT ON COLUMN public.executed_trades.actual_entry_price IS 'User-reported real fill price. Optional.';
COMMENT ON COLUMN public.executed_trades.actual_exit_price IS 'User-reported real exit price. Optional.';
COMMENT ON COLUMN public.executed_trades.derived_r IS 'R multiple derived server-side from the reported prices and the signal risk distance. Never user-supplied.';