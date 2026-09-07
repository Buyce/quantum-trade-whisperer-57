ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS consecutive_loss_pause_hours smallint;

ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_consecutive_loss_pause_hours_check;

ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_consecutive_loss_pause_hours_check
  CHECK (consecutive_loss_pause_hours IS NULL OR consecutive_loss_pause_hours IN (3, 5));

COMMENT ON COLUMN public.scanner_settings.consecutive_loss_pause_hours IS
  'How long a consecutive-loss pause lasts. NULL = until the next UTC midnight (default); 3 or 5 = that many hours from when the pause started.';