ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS max_same_bet_orders smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS same_bet_cooldown_minutes smallint NOT NULL DEFAULT 60;

ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_max_same_bet_orders_range;
ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_max_same_bet_orders_range
  CHECK (max_same_bet_orders >= 1 AND max_same_bet_orders <= 3);

ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_same_bet_cooldown_range;
ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_same_bet_cooldown_range
  CHECK (same_bet_cooldown_minutes IN (0, 30, 60, 120));

COMMENT ON COLUMN public.scanner_settings.max_same_bet_orders IS
  'How many unresolved automatic orders may be live on the same instrument and direction (1-3, default 1).';
COMMENT ON COLUMN public.scanner_settings.same_bet_cooldown_minutes IS
  'Minutes to refuse new automatic orders on an instrument+direction after a broker-confirmed loss there. 0 = off.';