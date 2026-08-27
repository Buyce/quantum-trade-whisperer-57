ALTER TABLE public.execution_deliveries
  ADD COLUMN IF NOT EXISTS entry_mode text;

ALTER TABLE public.execution_deliveries
  DROP CONSTRAINT IF EXISTS execution_deliveries_entry_mode_check;
ALTER TABLE public.execution_deliveries
  ADD CONSTRAINT execution_deliveries_entry_mode_check
  CHECK (entry_mode IS NULL OR entry_mode IN ('pending_limit', 'market'));

COMMENT ON COLUMN public.execution_deliveries.entry_mode IS
  'Engine-recorded submission mode: pending_limit or market. NULL only for deliveries created before this provenance field existed.';

ALTER TABLE public.connected_trading_accounts
  ADD COLUMN IF NOT EXISTS reconciliation_last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_last_error text;

COMMENT ON COLUMN public.connected_trading_accounts.reconciliation_last_success_at IS
  'Last completed broker-evidence reconciliation pass for this account.';
COMMENT ON COLUMN public.connected_trading_accounts.reconciliation_last_error_at IS
  'Last broker-evidence reconciliation failure observed for this account.';
COMMENT ON COLUMN public.connected_trading_accounts.reconciliation_last_error IS
  'Bounded operator diagnostic from the latest broker-evidence reconciliation failure; never a fabricated broker state.';