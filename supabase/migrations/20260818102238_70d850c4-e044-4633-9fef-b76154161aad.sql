-- Per-user risk profile. Lives on scanner_settings because it is read on the
-- same path as the feed filters, so a signal card needs no extra round trip.
-- Every value is advisory input to a client-side calculator: the scanner and
-- grading engine never read these columns.
ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS account_equity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS risk_per_trade_percent numeric NOT NULL DEFAULT 1,
  -- 0 means "no cap": a hard lot ceiling the calculated size is clamped to.
  ADD COLUMN IF NOT EXISTS max_position_size numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leverage integer NOT NULL DEFAULT 100,
  -- 0 means "off": maximum stop distance, as a percentage of entry price,
  -- above which a setup is flagged as wider than the user tolerates.
  ADD COLUMN IF NOT EXISTS max_stop_loss_percent numeric NOT NULL DEFAULT 0;

-- Immutable bounds only, so these are safe as CHECK constraints.
ALTER TABLE public.scanner_settings
  DROP CONSTRAINT IF EXISTS scanner_settings_risk_bounds;
ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_risk_bounds CHECK (
    account_equity >= 0
    AND risk_per_trade_percent > 0 AND risk_per_trade_percent <= 100
    AND max_position_size >= 0 AND max_position_size <= 1000
    AND leverage >= 1 AND leverage <= 3000
    AND max_stop_loss_percent >= 0 AND max_stop_loss_percent <= 100
  );