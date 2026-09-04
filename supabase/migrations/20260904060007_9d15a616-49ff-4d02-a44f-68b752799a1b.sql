-- ============================================================
-- MT4/MT5 audit — migration-first slice
-- User risk controls, news fail-closed protection, live confirmation
-- state, and emergency-stop metadata. Live defaults stay disabled.
-- ============================================================

-- 1. Scanner user controls: spread/slippage/exposure and news blocking
ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS max_entry_spread_pips numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_entry_slippage_pips numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_total_exposure_percent numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS news_block_new_entries boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS news_suppression_minutes_before integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS news_suppression_minutes_after integer NOT NULL DEFAULT 60;

COMMENT ON COLUMN public.scanner_settings.max_entry_spread_pips IS 'Reject an entry if live spread exceeds this value in pips. 0 = disabled.';
COMMENT ON COLUMN public.scanner_settings.max_entry_slippage_pips IS 'Max tolerated slippage versus published entry in pips. 0 = disabled.';
COMMENT ON COLUMN public.scanner_settings.max_total_exposure_percent IS 'Advisory/toggle-enforced ceiling on total open signal exposure as % of account equity. Default 10.';
COMMENT ON COLUMN public.scanner_settings.news_block_new_entries IS 'When true, suppress new automatic entries when news coverage is incomplete or inside an active event window (fail closed).';
COMMENT ON COLUMN public.scanner_settings.news_suppression_minutes_before IS 'Minutes before a known high-impact event to start suppressing new entries.';
COMMENT ON COLUMN public.scanner_settings.news_suppression_minutes_after IS 'Minutes after a known high-impact event to keep suppressing new entries.';

-- 2. Global emergency stop for the execution plane
ALTER TABLE public.execution_controls
  ADD COLUMN IF NOT EXISTS emergency_stop_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_stop_at timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_stop_reason text;

COMMENT ON COLUMN public.execution_controls.emergency_stop_enabled IS 'Global owner-operated kill switch. When true, no new automatic order may be submitted regardless of account arming.';
COMMENT ON COLUMN public.execution_controls.emergency_stop_at IS 'Timestamp the global emergency stop was last activated.';
COMMENT ON COLUMN public.execution_controls.emergency_stop_reason IS 'Operator reason recorded when the global emergency stop is toggled on.';

-- 3. Per-account emergency stop metadata (does not change broker state; forces observe-mode behaviour)
ALTER TABLE public.connected_trading_accounts
  ADD COLUMN IF NOT EXISTS emergency_stop_at timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_stop_reason text;

COMMENT ON COLUMN public.connected_trading_accounts.emergency_stop_at IS 'User/owner emergency stop for this account. Non-null forces the account to stand down to observe.';
COMMENT ON COLUMN public.connected_trading_accounts.emergency_stop_reason IS 'Reason recorded for the account-level emergency stop.';

-- 4. Delivery confirmation state and metadata
ALTER TABLE public.execution_deliveries
  ADD COLUMN IF NOT EXISTS requires_confirmation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmation_declined_reason text,
  ADD COLUMN IF NOT EXISTS confirmation_declined_at timestamptz;

COMMENT ON COLUMN public.execution_deliveries.requires_confirmation IS 'When true the delivery must be explicitly confirmed before a broker order is submitted (live_confirm flow).';
COMMENT ON COLUMN public.execution_deliveries.confirmation_expires_at IS 'Deadline after which an unconfirmed delivery expires and is settled as rejected.';
COMMENT ON COLUMN public.execution_deliveries.confirmed_at IS 'Timestamp the user/owner confirmed the delivery.';
COMMENT ON COLUMN public.execution_deliveries.confirmed_by IS 'User ID that confirmed the delivery.';
COMMENT ON COLUMN public.execution_deliveries.confirmation_declined_reason IS 'Reason recorded when a delivery is explicitly declined.';
COMMENT ON COLUMN public.execution_deliveries.confirmation_declined_at IS 'Timestamp the delivery was explicitly declined.';

-- Expand state machine to include awaiting_confirmation
ALTER TABLE public.execution_deliveries DROP CONSTRAINT IF EXISTS execution_deliveries_state_check;
ALTER TABLE public.execution_deliveries
  ADD CONSTRAINT execution_deliveries_state_check
  CHECK (state = ANY (ARRAY['pending'::text, 'awaiting_confirmation'::text, 'claimed'::text, 'sent'::text, 'acknowledged'::text, 'rejected'::text, 'unknown'::text, 'failed'::text, 'expired'::text]));

-- Index to quickly find deliveries needing human confirmation
CREATE INDEX IF NOT EXISTS execution_deliveries_awaiting_confirmation_idx
  ON public.execution_deliveries (enqueued_at)
  WHERE state = 'awaiting_confirmation' AND requires_confirmation = true;