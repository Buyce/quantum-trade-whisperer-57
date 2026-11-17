alter table public.connected_trading_accounts add column if not exists live_auto_default_applied_at timestamptz null;
-- Existing accounts keep whatever mode their owner already has; only new connections get the default once.
update public.connected_trading_accounts set live_auto_default_applied_at = now() where live_auto_default_applied_at is null;