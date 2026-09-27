-- Account-scoped policy configuration for multi-account execution.
-- Additive only: existing accounts receive no execution policy and therefore
-- cannot be newly authorised by this migration.
create table if not exists public.connected_account_risk_policies (
  account_id uuid primary key references public.connected_trading_accounts(id) on delete cascade,
  user_id uuid not null,
  policy_kind text not null check (policy_kind in ('standard', 'equity_edge_instant_50k')),
  starting_balance numeric not null check (starting_balance > 0),
  operating_risk_per_trade_percent numeric not null check (operating_risk_per_trade_percent >= 0),
  hard_risk_per_trade_percent numeric not null check (hard_risk_per_trade_percent > 0),
  max_daily_loss_percent numeric,
  max_total_loss_percent numeric,
  trailing_drawdown boolean not null default false,
  consistency_percent numeric,
  safety_buffer_percent numeric,
  min_trading_days integer,
  max_trades_per_day integer,
  news_trading_allowed boolean,
  high_watermark numeric,
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operating_risk_below_hard_limit
    check (operating_risk_per_trade_percent <= hard_risk_per_trade_percent)
);

alter table public.connected_account_risk_policies enable row level security;

drop policy if exists "account owners read risk policy" on public.connected_account_risk_policies;
create policy "account owners read risk policy"
on public.connected_account_risk_policies
for select
using (auth.uid() = user_id);

-- Prop/risk constraints are execution authority, not user preferences.
-- Authenticated clients may read their own policy but may not insert/update/delete it.
-- Trusted server/service-role code bypasses RLS when a validated mutation is required.
revoke insert, update, delete on public.connected_account_risk_policies from authenticated;

create index if not exists connected_account_risk_policies_user_idx
  on public.connected_account_risk_policies(user_id);

comment on table public.connected_account_risk_policies is
  'Per-connected-account execution/risk policy. Missing row means fail closed; no live account is auto-enrolled.';
