ALTER TABLE public.execution_deliveries
  ADD COLUMN IF NOT EXISTS risk_amount numeric,
  ADD COLUMN IF NOT EXISTS risk_currency text,
  ADD COLUMN IF NOT EXISTS risk_percent_of_equity numeric;

COMMENT ON COLUMN public.execution_deliveries.risk_amount IS 'Cash at risk computed at submission from the authoritative sizing run. NULL for rows submitted before this column existed - never inferred.';
COMMENT ON COLUMN public.execution_deliveries.risk_percent_of_equity IS 'Cash at risk as a percent of broker-reported equity at submission. NULL means unknown, not zero.';

CREATE INDEX IF NOT EXISTS execution_deliveries_account_exposure_idx
  ON public.execution_deliveries (connected_account_id, state)
  WHERE connected_account_id IS NOT NULL;