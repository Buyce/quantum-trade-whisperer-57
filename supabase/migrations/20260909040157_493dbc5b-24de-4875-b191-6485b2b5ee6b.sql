ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS cancel_matching_on_pause boolean NOT NULL DEFAULT false;

UPDATE public.scanner_settings
  SET cancel_matching_on_pause = false
  WHERE cancel_matching_on_pause IS NULL;

ALTER TABLE public.account_risk_state
  ADD COLUMN IF NOT EXISTS cancelled_matching_orders integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unconfirmed_matching_orders integer NOT NULL DEFAULT 0;
