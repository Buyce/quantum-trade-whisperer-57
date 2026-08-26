ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS auto_order_window_minutes integer NOT NULL DEFAULT 180;

ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_auto_order_window_range
  CHECK (auto_order_window_minutes >= 0 AND auto_order_window_minutes <= 360);