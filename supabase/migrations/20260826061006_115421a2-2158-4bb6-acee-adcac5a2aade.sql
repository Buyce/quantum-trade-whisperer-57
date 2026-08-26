ALTER TABLE public.scanner_settings DROP CONSTRAINT IF EXISTS scanner_settings_concurrent_orders_range;
ALTER TABLE public.scanner_settings ADD CONSTRAINT scanner_settings_concurrent_orders_range CHECK (maximum_concurrent_signal_orders >= 0 AND maximum_concurrent_signal_orders <= 100);

ALTER TABLE public.scanner_settings DROP CONSTRAINT IF EXISTS scanner_settings_daily_orders_range;
ALTER TABLE public.scanner_settings ADD CONSTRAINT scanner_settings_daily_orders_range CHECK (maximum_daily_signal_orders >= 0 AND maximum_daily_signal_orders <= 100);

ALTER TABLE public.scanner_settings DROP CONSTRAINT IF EXISTS scanner_settings_max_active_orders_range;
ALTER TABLE public.scanner_settings ADD CONSTRAINT scanner_settings_max_active_orders_range CHECK (maximum_active_signal_orders >= 0 AND maximum_active_signal_orders <= 100);

ALTER TABLE public.scanner_settings DROP CONSTRAINT IF EXISTS scanner_settings_per_symbol_ceiling_range;
ALTER TABLE public.scanner_settings ADD CONSTRAINT scanner_settings_per_symbol_ceiling_range CHECK (maximum_daily_orders_per_symbol >= 0 AND maximum_daily_orders_per_symbol <= 100);

ALTER TABLE public.scanner_settings DROP CONSTRAINT IF EXISTS scanner_settings_adaptive_ceiling_range;
ALTER TABLE public.scanner_settings ADD CONSTRAINT scanner_settings_adaptive_ceiling_range CHECK (adaptive_order_ceiling_max >= 0 AND adaptive_order_ceiling_max <= 100 AND adaptive_order_ceiling_floor >= 0 AND adaptive_order_ceiling_floor <= 100);