-- Drawdown brakes: owner-configured loss limits, and a broker-derived risk state per account.

ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS drawdown_brakes_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_loss_limit_percent numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS weekly_loss_limit_percent numeric NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS consecutive_loss_limit integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS max_drawdown_percent numeric NOT NULL DEFAULT 10;

-- Existing owners are NOT opted in: their rules must not change under them.
UPDATE public.scanner_settings
SET drawdown_brakes_enabled = false,
    daily_loss_limit_percent = 0,
    weekly_loss_limit_percent = 0,
    consecutive_loss_limit = 0,
    max_drawdown_percent = 0;

CREATE TABLE IF NOT EXISTS public.account_risk_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.connected_trading_accounts(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL DEFAULT now(),
  -- Realised, closed-trade only. Never journal guesses, never open P&L.
  day_utc date,
  day_realized numeric,
  week_start_utc date,
  week_realized numeric,
  realized_currency text,
  consecutive_losses integer,
  closed_sample integer NOT NULL DEFAULT 0,
  -- Equity high-water mark accumulated from broker observations only.
  peak_equity numeric,
  peak_equity_at timestamptz,
  current_equity numeric,
  current_equity_at timestamptz,
  drawdown_percent numeric,
  measured boolean NOT NULL DEFAULT false,
  unmeasured_reason text,
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  pause_detail text,
  paused_at timestamptz,
  resume_after timestamptz,
  resume_boundary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_risk_state_account_unique UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS account_risk_state_user_idx ON public.account_risk_state (user_id);
CREATE INDEX IF NOT EXISTS account_risk_state_paused_idx ON public.account_risk_state (paused) WHERE paused;

GRANT SELECT ON public.account_risk_state TO authenticated;
GRANT ALL ON public.account_risk_state TO service_role;

ALTER TABLE public.account_risk_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read their own risk state" ON public.account_risk_state;
CREATE POLICY "Owners read their own risk state"
  ON public.account_risk_state FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS account_risk_state_updated_at ON public.account_risk_state;
CREATE TRIGGER account_risk_state_updated_at
  BEFORE UPDATE ON public.account_risk_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();