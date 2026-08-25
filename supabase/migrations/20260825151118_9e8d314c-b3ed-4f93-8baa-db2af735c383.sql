ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS maximum_active_signal_orders smallint NOT NULL DEFAULT 3;

ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_max_active_orders_range;

ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_max_active_orders_range
  CHECK (maximum_active_signal_orders >= 0 AND maximum_active_signal_orders <= 10);

COMMENT ON COLUMN public.scanner_settings.maximum_active_signal_orders IS
  'Ceiling on concurrent automatic orders reconciled from active signals (0 disables reconciliation, max 10). Never a quota: subordinate to daily caps, risk, exposure and every downstream gate.';