ALTER TABLE public.execution_controls
  ADD COLUMN IF NOT EXISTS customer_live_confirm_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_live_auto_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_kill_switch_reason text;

COMMENT ON COLUMN public.execution_controls.customer_live_confirm_enabled IS 'Customers may arm live_confirm (per-trade owner confirmation). Nested under live_execution_enabled.';
COMMENT ON COLUMN public.execution_controls.customer_live_auto_enabled IS 'Customers may arm live_auto (no per-trade confirmation). Nested under live_execution_enabled and live_auto_enabled.';
COMMENT ON COLUMN public.execution_controls.live_kill_switch_reason IS 'When set, live submissions are refused and this reason is shown.';

-- Conservative starting point for NEW settings rows only. ALTER ... SET DEFAULT
-- never rewrites existing rows, so no current user's configuration changes.
ALTER TABLE public.scanner_settings
  ALTER COLUMN alert_min_grade SET DEFAULT 'A'::signal_grade,
  ALTER COLUMN risk_per_trade_percent SET DEFAULT 0.5,
  ALTER COLUMN max_total_exposure_percent SET DEFAULT 1,
  ALTER COLUMN maximum_daily_signal_orders SET DEFAULT 2,
  ALTER COLUMN maximum_concurrent_signal_orders SET DEFAULT 1;