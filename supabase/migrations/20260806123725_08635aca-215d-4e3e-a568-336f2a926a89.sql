ALTER TABLE public.scanner_settings ALTER COLUMN daily_setup_cap SET DEFAULT 30;
UPDATE public.scanner_settings SET daily_setup_cap = 30 WHERE daily_setup_cap = 15;
ALTER TABLE public.scanner_settings ADD COLUMN IF NOT EXISTS alert_min_grade signal_grade NOT NULL DEFAULT 'B';