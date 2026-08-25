CREATE TABLE public.execution_enqueue_decisions (
  id BIGSERIAL PRIMARY KEY,
  signal_id UUID,
  user_id UUID,
  instrument TEXT,
  grade TEXT,
  decision TEXT NOT NULL,
  detail TEXT,
  enqueued INTEGER NOT NULL DEFAULT 0,
  filtered INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.execution_enqueue_decisions TO authenticated;
GRANT ALL ON public.execution_enqueue_decisions TO service_role;

ALTER TABLE public.execution_enqueue_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own and system-wide enqueue decisions are readable"
  ON public.execution_enqueue_decisions
  FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

CREATE INDEX execution_enqueue_decisions_recent_idx
  ON public.execution_enqueue_decisions (created_at DESC);

CREATE INDEX execution_enqueue_decisions_user_recent_idx
  ON public.execution_enqueue_decisions (user_id, created_at DESC);

ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS auto_intel_gate_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_intel_min_win_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS auto_intel_min_sample INTEGER NOT NULL DEFAULT 30;

CREATE OR REPLACE FUNCTION public.bump_execution_config_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.webhook_url IS DISTINCT FROM OLD.webhook_url
     OR NEW.webhook_format IS DISTINCT FROM OLD.webhook_format
     OR md5(COALESCE(NEW.webhook_secret, '')) IS DISTINCT FROM md5(COALESCE(OLD.webhook_secret, ''))
     OR NEW.webhook_enabled IS DISTINCT FROM OLD.webhook_enabled
     OR NEW.execution_enabled IS DISTINCT FROM OLD.execution_enabled
     OR NEW.execution_dry_run IS DISTINCT FROM OLD.execution_dry_run
     OR NEW.order_strategy IS DISTINCT FROM OLD.order_strategy
     OR NEW.exposure_limit_enabled IS DISTINCT FROM OLD.exposure_limit_enabled
     OR NEW.account_equity IS DISTINCT FROM OLD.account_equity
     OR NEW.account_currency IS DISTINCT FROM OLD.account_currency
     OR NEW.risk_per_trade_percent IS DISTINCT FROM OLD.risk_per_trade_percent
     OR NEW.max_position_size IS DISTINCT FROM OLD.max_position_size
     OR NEW.leverage IS DISTINCT FROM OLD.leverage
     OR NEW.max_stop_loss_percent IS DISTINCT FROM OLD.max_stop_loss_percent
     OR NEW.instruments IS DISTINCT FROM OLD.instruments
     OR NEW.sessions IS DISTINCT FROM OLD.sessions
     OR NEW.alert_min_grade IS DISTINCT FROM OLD.alert_min_grade
     OR NEW.daily_setup_cap IS DISTINCT FROM OLD.daily_setup_cap
     OR NEW.auto_intel_gate_enabled IS DISTINCT FROM OLD.auto_intel_gate_enabled
     OR NEW.auto_intel_min_win_pct IS DISTINCT FROM OLD.auto_intel_min_win_pct
     OR NEW.auto_intel_min_sample IS DISTINCT FROM OLD.auto_intel_min_sample
     OR NEW.live_execution_confirmed_at IS DISTINCT FROM OLD.live_execution_confirmed_at
     OR NEW.live_execution_confirmed_global_live IS DISTINCT FROM OLD.live_execution_confirmed_global_live
  THEN
    NEW.execution_config_version := COALESCE(OLD.execution_config_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$;