ALTER TABLE public.scanner_settings
  ADD CONSTRAINT scanner_settings_high_risk_ack_chk
  CHECK (risk_per_trade_percent <= 2 OR risk_ack_high = true) NOT VALID;