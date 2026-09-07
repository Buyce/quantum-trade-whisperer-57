ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_auto_order_window_range;

ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_auto_order_window_range
  CHECK (auto_order_window_minutes >= 0 AND auto_order_window_minutes <= 600);