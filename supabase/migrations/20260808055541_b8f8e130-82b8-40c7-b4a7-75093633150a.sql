CREATE UNIQUE INDEX IF NOT EXISTS scanned_signals_active_unique
  ON public.scanned_signals (instrument, direction, round(entry_price, 5))
  WHERE status = 'active';

ALTER TABLE public.scanner_settings ALTER COLUMN daily_setup_cap SET DEFAULT 50;