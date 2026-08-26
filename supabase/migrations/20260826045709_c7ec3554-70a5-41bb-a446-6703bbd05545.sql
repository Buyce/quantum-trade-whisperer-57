ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS maximum_concurrent_signal_orders integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS maximum_daily_signal_orders integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS auto_market_entry_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_unmeasured_intel boolean NOT NULL DEFAULT false;

ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_concurrent_orders_range,
  DROP CONSTRAINT IF EXISTS scanner_settings_daily_orders_range;

ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_concurrent_orders_range
    CHECK (maximum_concurrent_signal_orders BETWEEN 0 AND 10),
  ADD CONSTRAINT scanner_settings_daily_orders_range
    CHECK (maximum_daily_signal_orders BETWEEN 0 AND 25);

UPDATE public.scanner_settings
   SET maximum_daily_signal_orders = LEAST(GREATEST(COALESCE(maximum_active_signal_orders, 3), 0), 25),
       maximum_concurrent_signal_orders = LEAST(GREATEST(COALESCE(maximum_active_signal_orders, 3), 0), 10);