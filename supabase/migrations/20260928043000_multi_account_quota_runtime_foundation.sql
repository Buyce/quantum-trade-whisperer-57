-- Multi-account quota foundation + persisted daily objective.
-- Defaults support two demo accounts and one live account. Per-user overrides keep
-- the quota configurable without weakening the database enforcement boundary.

alter table public.connected_account_risk_policies
  add column if not exists daily_profit_objective numeric null;

update public.connected_account_risk_policies
set daily_profit_objective = 200
where policy_kind = 'equity_edge_instant_50k'
  and daily_profit_objective is null;

create table if not exists public.connected_account_quota_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_demo integer not null default 2 check (max_demo >= 0 and max_demo <= 20),
  max_live integer not null default 1 check (max_live >= 0 and max_live <= 20),
  updated_at timestamptz not null default now()
);

alter table public.connected_account_quota_overrides enable row level security;

-- Quotas are operator-controlled. End users may read their effective override
-- only through account_quota(); they cannot mutate this table directly.
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
    coalesce(q.max_live, 1)::integer
  from (select 1) seed
  left join public.connected_account_quota_overrides q on q.user_id = _user_id;
$$;

revoke all on function public.account_quota(uuid) from public;
grant execute on function public.account_quota(uuid) to service_role;

create or replace function public.enforce_connected_account_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limits record;
  used_count integer;
begin
  select * into limits from public.account_quota(new.user_id);

  if new.intent = 'demo' then
    select count(*) into used_count
    from public.connected_trading_accounts
    where user_id = new.user_id and intent = 'demo' and disconnected_at is null;
    if used_count >= limits.max_demo then
      raise exception 'account_quota_exceeded:demo';
    end if;
  elsif new.intent = 'live' then
    select count(*) into used_count
    from public.connected_trading_accounts
    where user_id = new.user_id and intent = 'live' and disconnected_at is null;
    if used_count >= limits.max_live then
      raise exception 'account_quota_exceeded:live';
    end if;
  else
    raise exception 'invalid_account_intent';
  end if;

  return new;
end;
$$;

-- Remove prior quota triggers on this table by function source/name, then install
-- one canonical trigger. This migration intentionally leaves unrelated triggers alone.
do $$
declare
  t record;
begin
  for t in
    select tg.tgname
    from pg_trigger tg
    join pg_proc p on p.oid = tg.tgfoid
    where tg.tgrelid = 'public.connected_trading_accounts'::regclass
      and not tg.tgisinternal
      and (
        p.proname = 'enforce_connected_account_quota'
        or p.prosrc ilike '%account_quota_exceeded%'
        or tg.tgname ilike '%quota%'
      )
  loop
    execute format('drop trigger if exists %I on public.connected_trading_accounts', t.tgname);
  end loop;
end $$;

create trigger enforce_connected_account_quota_before_insert
before insert on public.connected_trading_accounts
for each row execute function public.enforce_connected_account_quota();
