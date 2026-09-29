-- Direct MT5 bridge pairing and read-only snapshot ingestion.
-- Connection is not execution authority: no row created here can arm trading.
create table if not exists public.mt5_bridge_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bridge_id text not null unique,
  intent text not null check (intent in ('demo', 'live')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  token_created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_sequence bigint not null default -1 check (last_sequence >= -1),
  last_seen_at timestamptz,
  last_observed_at timestamptz,
  status text not null default 'awaiting_first_snapshot'
    check (status in ('awaiting_first_snapshot', 'healthy', 'degraded', 'refused', 'revoked')),
  status_reason text,
  account_key text,
  broker_login_masked text,
  broker_server text,
  broker_name text,
  broker_mode text check (broker_mode is null or broker_mode in ('demo', 'live', 'contest', 'unknown')),
  snapshot jsonb
);

alter table public.mt5_bridge_connections enable row level security;

drop policy if exists "owners read direct mt5 bridges" on public.mt5_bridge_connections;
create policy "owners read direct mt5 bridges"
on public.mt5_bridge_connections
for select
using (auth.uid() = user_id);

revoke insert, update, delete on public.mt5_bridge_connections from authenticated;
create index if not exists mt5_bridge_connections_user_idx
  on public.mt5_bridge_connections(user_id, created_at desc);

comment on table public.mt5_bridge_connections is
  'Read-only direct-MT5 bridge pairings. Token hashes only; snapshots are broker-derived observations and never execution authority.';

create or replace function public.ingest_mt5_bridge_snapshot(
  _token_hash text,
  _bridge_id text,
  _sequence bigint,
  _observed_at timestamptz,
  _snapshot jsonb
)
returns table(connection_id uuid, owner_id uuid, connection_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  _row public.mt5_bridge_connections%rowtype;
  _mode text;
  _terminal_connected boolean;
  _trade_allowed boolean;
begin
  select * into _row
  from public.mt5_bridge_connections
  where token_hash = _token_hash
    and bridge_id = _bridge_id
  for update;

  if not found then
    raise exception 'bridge authentication failed';
  end if;
  if _row.revoked_at is not null then
    raise exception 'bridge pairing is revoked';
  end if;
  -- Idempotent retry: if P-Trades committed the previous upload but the HTTP
  -- response was lost, the bridge may safely repeat the exact same sequence and
  -- JSON snapshot. A different payload at the same/lower sequence is a replay.
  if _sequence = _row.last_sequence and _snapshot = _row.snapshot then
    return query select _row.id, _row.user_id, _row.status;
    return;
  end if;
  if _sequence <= _row.last_sequence then
    raise exception 'bridge sequence is stale or replayed';
  end if;
  if _observed_at < now() - interval '90 seconds'
     or _observed_at > now() + interval '30 seconds' then
    raise exception 'bridge snapshot timestamp is outside the freshness window';
  end if;
  if coalesce((_snapshot->>'protocolVersion')::int, -1) <> 1 then
    raise exception 'unsupported bridge protocol version';
  end if;
  if _snapshot->>'bridgeId' is distinct from _bridge_id then
    raise exception 'bridge id does not match authenticated pairing';
  end if;
  if coalesce((_snapshot#>>'{account,provider}'), '') <> 'mt5_direct'
     or coalesce((_snapshot#>>'{account,platform}'), '') <> 'mt5' then
    raise exception 'snapshot is not direct MT5 broker evidence';
  end if;

  _mode := coalesce(_snapshot#>>'{account,mode}', 'unknown');
  if _mode not in ('demo', 'live') or _mode <> _row.intent then
    update public.mt5_bridge_connections
    set status = 'refused',
        status_reason = 'Broker-confirmed account mode does not match pairing intent.',
        last_seen_at = now(),
        last_observed_at = _observed_at,
        last_sequence = _sequence,
        broker_mode = _mode
    where id = _row.id;
    return query select _row.id, _row.user_id, 'refused'::text;
    return;
  end if;

  _terminal_connected := coalesce((_snapshot#>>'{terminal,connected}')::boolean, false);
  _trade_allowed := coalesce((_snapshot#>>'{account,tradeAllowed}')::boolean, false);

  update public.mt5_bridge_connections
  set last_sequence = _sequence,
      last_seen_at = now(),
      last_observed_at = _observed_at,
      status = case when _terminal_connected then 'healthy' else 'degraded' end,
      status_reason = case
        when not _terminal_connected then 'MT5 terminal reports disconnected.'
        when not _trade_allowed then 'Broker account is connected but trading permission is not available.'
        else null
      end,
      account_key = nullif(_snapshot#>>'{account,accountKey}', ''),
      broker_login_masked = nullif(_snapshot#>>'{account,loginMasked}', ''),
      broker_server = nullif(_snapshot#>>'{account,server}', ''),
      broker_name = nullif(_snapshot#>>'{account,broker}', ''),
      broker_mode = _mode,
      snapshot = _snapshot
  where id = _row.id;

  return query
    select _row.id, _row.user_id,
      case when _terminal_connected then 'healthy'::text else 'degraded'::text end;
end;
$$;

revoke all on function public.ingest_mt5_bridge_snapshot(text, text, bigint, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_mt5_bridge_snapshot(text, text, bigint, timestamptz, jsonb)
  to service_role;
