-- Multi-account quota foundation + persisted daily objective.
-- This migration does NOT seed or mutate any existing account risk policy row.
-- Existing accounts therefore remain fail-closed until explicitly configured.

alter table public.connected_account_risk_policies
  add column if not exists daily_profit_objective numeric null;

create table if not exists public.connected_account_quota_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_demo integer not null default 2 check (max_demo >= 0 and max_demo <= 20),
  max_live integer not null default 2 check (max_live >= 0 and max_live <= 20),
  updated_at timestamptz not null default now()
);

alter table public.connected_account_quota_overrides enable row level security;

revoke all on public.connected_account_quota_overrides from anon, authenticated;

create or replace function public.account_quota(_user_id uuid)
returns table(max_demo integer, max_live integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(q.max_demo, 2)::integer,
    coalesce(q.max_live, 2)::integer
  from (select 1) seed
  left join public.connected_account_quota_overrides q on q.user_id = _user_id;
$$;

revoke all on function public.account_quota(uuid) from public;
grant execute on function public.account_quota(uuid) to service_role;
