ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS live_execution_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_execution_confirmed_version integer,
  ADD COLUMN IF NOT EXISTS live_execution_confirmed_host text,
  ADD COLUMN IF NOT EXISTS live_execution_confirmed_global_live boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.bump_execution_config_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
     OR NEW.live_execution_confirmed_at IS DISTINCT FROM OLD.live_execution_confirmed_at
     OR NEW.live_execution_confirmed_global_live IS DISTINCT FROM OLD.live_execution_confirmed_global_live
  THEN
    NEW.execution_config_version := COALESCE(OLD.execution_config_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$function$;