ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS order_strategy text NOT NULL DEFAULT 'smart_adaptive',
  ADD COLUMN IF NOT EXISTS webhook_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_url text,
  ADD COLUMN IF NOT EXISTS webhook_secret text,
  ADD COLUMN IF NOT EXISTS webhook_format text NOT NULL DEFAULT 'json';

ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_order_strategy_check;
ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_order_strategy_check
  CHECK (order_strategy IN ('smart_adaptive', 'strict_retest'));

ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_webhook_format_check;
ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_webhook_format_check
  CHECK (webhook_format IN ('json', 'pineconnector'));

ALTER TABLE public.scanned_signals
  ADD COLUMN IF NOT EXISTS max_acceptable_entry numeric;