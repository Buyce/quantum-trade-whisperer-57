-- The owner may read ordinary settings but a saved bridge secret is write-only
-- through the authenticated server function.  Execution-authorisation fields
-- are also server-written so a direct PostgREST call cannot forge URL
-- validation, dry/live confirmation or configuration identity.
--
-- Existing values are not moved, cleared or transformed: this is a privilege
-- boundary only, so deployed bridges keep the exact secret and connection they
-- already use.
REVOKE SELECT, INSERT, UPDATE ON TABLE public.scanner_settings FROM authenticated;

GRANT SELECT (
  account_currency,
  account_equity,
  alert_min_grade,
  created_at,
  daily_setup_cap,
  equity_as_of,
  execution_config_version,
  execution_dry_run,
  execution_enabled,
  exposure_limit_enabled,
  instruments,
  leverage,
  live_execution_confirmed_at,
  live_execution_confirmed_global_live,
  live_execution_confirmed_host,
  live_execution_confirmed_version,
  max_position_size,
  max_stop_loss_percent,
  min_grade,
  notify_email,
  notify_push,
  order_strategy,
  risk_ack_high,
  risk_per_trade_percent,
  sessions,
  timeframes,
  updated_at,
  user_id,
  webhook_enabled,
  webhook_format,
  webhook_url,
  webhook_validated_at,
  webhook_validation_reason
) ON public.scanner_settings TO authenticated;

-- These are the fields the terminal and MCP settings tools are allowed to
-- create/change directly under owner RLS.  Bridge destination, credential and
-- live-authorisation fields are intentionally absent and are written only by
-- saveBridgeSettings with the service-role client after server validation.
GRANT INSERT (
  account_currency,
  account_equity,
  alert_min_grade,
  daily_setup_cap,
  equity_as_of,
  instruments,
  leverage,
  max_position_size,
  max_stop_loss_percent,
  min_grade,
  notify_email,
  notify_push,
  order_strategy,
  risk_ack_high,
  risk_per_trade_percent,
  sessions,
  timeframes,
  user_id
) ON public.scanner_settings TO authenticated;

GRANT UPDATE (
  account_currency,
  account_equity,
  alert_min_grade,
  daily_setup_cap,
  equity_as_of,
  instruments,
  leverage,
  max_position_size,
  max_stop_loss_percent,
  min_grade,
  notify_email,
  notify_push,
  order_strategy,
  risk_ack_high,
  risk_per_trade_percent,
  sessions,
  timeframes
) ON public.scanner_settings TO authenticated;

COMMENT ON COLUMN public.scanner_settings.webhook_secret IS
  'Server-only write/read credential. Existing values are preserved; authenticated clients have no SELECT/INSERT/UPDATE privilege on this column.';
