create type public.signal_grade as enum ('A','B','C');
create type public.trade_direction as enum ('long','short');
create type public.decision_kind as enum ('taken','skipped');
create type public.trade_outcome as enum ('win','loss','breakeven','open');
create type public.tf_code as enum ('H4','H1','M15');

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- scanned signals
create table public.scanned_signals (
  id uuid primary key default gen_random_uuid(),
  detected_at timestamptz not null default now(),
  instrument text not null,
  grade public.signal_grade not null,
  direction public.trade_direction not null,
  entry_price numeric(18,5) not null,
  stop_loss numeric(18,5) not null,
  tp1 numeric(18,5) not null,
  tp2 numeric(18,5) not null,
  tp3 numeric(18,5) not null,
  atr numeric(18,5) not null,
  rr_ratio numeric(6,2) not null,
  confidence_score numeric(5,2) not null,
  c_alignment numeric(5,2) not null default 0,
  c_rr numeric(5,2) not null default 0,
  c_symmetry numeric(5,2) not null default 0,
  c_volatility numeric(5,2) not null default 0,
  pattern_symmetry numeric(5,2) not null default 0,
  h4_bias text,
  h1_bias text,
  m15_bias text,
  qualitative_breakdown text not null default '',
  status text not null default 'active',
  resolved_outcome public.trade_outcome not null default 'open',
  resolved_r_multiple numeric(6,2),
  created_at timestamptz not null default now()
);
create index scanned_signals_detected_at_idx on public.scanned_signals (detected_at desc);
create index scanned_signals_instrument_idx on public.scanned_signals (instrument);
grant select on public.scanned_signals to authenticated;
grant all on public.scanned_signals to service_role;
alter table public.scanned_signals enable row level security;
create policy "signals_readable_by_authenticated" on public.scanned_signals for select to authenticated using (true);

-- market context
create table public.market_context (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null unique references public.scanned_signals(id) on delete cascade,
  trading_session text not null,
  volatility_index numeric(6,2) not null default 0,
  time_of_day int not null,
  day_of_week int not null,
  created_at timestamptz not null default now()
);
grant select on public.market_context to authenticated;
grant all on public.market_context to service_role;
alter table public.market_context enable row level security;
create policy "context_readable_by_authenticated" on public.market_context for select to authenticated using (true);

-- executed trades
create table public.executed_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  signal_id uuid not null references public.scanned_signals(id) on delete cascade,
  user_decision public.decision_kind not null,
  outcome public.trade_outcome not null default 'open',
  realized_r_multiple numeric(6,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, signal_id)
);
create index executed_trades_user_idx on public.executed_trades (user_id, created_at desc);
grant select, insert, update, delete on public.executed_trades to authenticated;
grant all on public.executed_trades to service_role;
alter table public.executed_trades enable row level security;
create policy "trades_manage_own" on public.executed_trades for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger executed_trades_touch before update on public.executed_trades for each row execute function public.touch_updated_at();

-- scanner settings
create table public.scanner_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  instruments text[] not null default array['XAUUSD','GBPAUD','EURUSD'],
  timeframes text[] not null default array['H4','H1','M15'],
  sessions text[] not null default array['london','london_new_york_overlap','new_york'],
  min_grade public.signal_grade not null default 'C',
  daily_setup_cap int not null default 15,
  notify_push boolean not null default true,
  notify_email boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.scanner_settings to authenticated;
grant all on public.scanner_settings to service_role;
alter table public.scanner_settings enable row level security;
create policy "settings_manage_own" on public.scanner_settings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger scanner_settings_touch before update on public.scanner_settings for each row execute function public.touch_updated_at();

-- instrument health
create table public.instrument_health (
  instrument text primary key,
  available boolean not null default true,
  last_error text,
  unavailable_until timestamptz,
  updated_at timestamptz not null default now()
);
grant select on public.instrument_health to authenticated;
grant all on public.instrument_health to service_role;
alter table public.instrument_health enable row level security;
create policy "health_readable_by_authenticated" on public.instrument_health for select to authenticated using (true);

-- scan queue
create table public.scan_queue (
  id bigserial primary key,
  instrument text not null,
  timeframe public.tf_code not null,
  status text not null default 'pending',
  attempts int not null default 0,
  payload jsonb,
  error text,
  enqueued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index scan_queue_status_idx on public.scan_queue (status, enqueued_at);
grant select on public.scan_queue to authenticated;
grant all on public.scan_queue to service_role;
grant usage, select on sequence public.scan_queue_id_seq to service_role;
alter table public.scan_queue enable row level security;
create policy "queue_readable_by_authenticated" on public.scan_queue for select to authenticated using (true);

-- new user bootstrap
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into public.scanner_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- realtime for new signals
alter publication supabase_realtime add table public.scanned_signals;

insert into public.instrument_health (instrument) values ('XAUUSD'), ('GBPAUD'), ('EURUSD');

-- seed ~180 historical signals with outcomes
do $$
declare
  i int; inst text; base numeric; atrv numeric; g public.signal_grade; dir public.trade_direction;
  entry numeric; risk numeric; sl numeric; t1 numeric; t2 numeric; t3 numeric;
  align numeric; rrq numeric; sym numeric; volq numeric; conf numeric; rr numeric;
  ts timestamptz; hr int; sess text; sig uuid; p numeric; outc public.trade_outcome; rmul numeric;
  h4 text; h1 text; m15 text; brk text; dirw text; winp numeric;
begin
  perform setseed(0.4242);
  for i in 0..179 loop
    ts := date_trunc('hour', now()) - (i * interval '4 hours') - ((floor(random()*4))::int * interval '15 minutes');
    hr := extract(hour from ts)::int;
    if i % 3 = 0 then inst := 'XAUUSD'; base := 2350 * (1 + (random()-0.5)*0.03); atrv := 11 + random()*5;
    elsif i % 3 = 1 then inst := 'GBPAUD'; base := 1.92 * (1 + (random()-0.5)*0.02); atrv := 0.0075 + random()*0.0025;
    else inst := 'EURUSD'; base := 1.085 * (1 + (random()-0.5)*0.02); atrv := 0.0035 + random()*0.0015;
    end if;

    p := random();
    if p < 0.20 then g := 'A'; elsif p < 0.55 then g := 'B'; else g := 'C'; end if;

    if random() < 0.5 then dir := 'long'; dirw := 'bullish'; else dir := 'short'; dirw := 'bearish'; end if;

    entry := base;
    risk := atrv * (0.85 + random()*0.6);
    if dir = 'long' then
      sl := entry - risk; t1 := entry + risk; t2 := entry + 2*risk; t3 := entry + 3*risk;
    else
      sl := entry + risk; t1 := entry - risk; t2 := entry - 2*risk; t3 := entry - 3*risk;
    end if;

    rr := round((1.8 + random()*1.3)::numeric, 2);
    if g = 'A' then align := 90 + random()*10; sym := 80 + random()*15;
    elsif g = 'B' then align := 68 + random()*17; sym := 62 + random()*22;
    else align := 38 + random()*22; sym := 42 + random()*26;
    end if;
    rrq := least(100, round((rr / 3.0 * 100)::numeric, 2));
    volq := 48 + random()*42;
    conf := round((0.4*align + 0.3*rrq + 0.2*sym + 0.1*volq)::numeric, 2);

    if g = 'A' then
      h4 := dirw; h1 := dirw; m15 := dirw;
      brk := format('A-Grade: moving-average stack is aligned %s on H4, H1 and M15. Price is retracing into the Point C structural liquidity zone and reacting with a %s M15 displacement candle. Stop sits beyond the structural extreme with a %s ATR buffer. Pattern symmetry of %s%% confirms the AB and BC legs are proportional. No macro resistance obstructs the 1:3 extension.', dirw, dirw, round(atrv::numeric,5), round(sym,1));
    elsif g = 'B' then
      h4 := 'ranging / approaching macro resistance'; h1 := dirw; m15 := dirw;
      brk := format('B-Grade: primary trend alignment confirmed %s on H1 and M15, but H4 shows price approaching a major macroeconomic resistance shelf, so the 1:3 extension is discounted. Point C reaction is valid and the ABC retracement holds a %s%% symmetry score. Manage to 1:2 unless H4 clears the shelf.', dirw, round(sym,1));
    else
      h4 := 'conflicting'; h1 := 'conflicting'; m15 := dirw;
      brk := format('C-Grade: aggressive M15 localized structural break %s against higher-timeframe context — H4 and H1 both conflict, so this is a mean-reversion scalp, not a trend continuation. Symmetry is weak at %s%% and timeframe alignment scores only %s%%. Default philosophy is No Trade unless volatility context is exceptional.', dirw, round(sym,1), round(align,1));
    end if;

    if hr < 7 then sess := 'tokyo';
    elsif hr < 12 then sess := 'london';
    elsif hr < 17 then sess := 'london_new_york_overlap';
    elsif hr < 21 then sess := 'new_york';
    else sess := 'sydney'; end if;

    if g = 'A' then winp := 0.62; elsif g = 'B' then winp := 0.50; else winp := 0.37; end if;
    p := random();
    if i < 3 then
      outc := 'open'; rmul := null;
    elsif p < winp then
      outc := 'win'; rmul := round((0.9 + random()*2.2)::numeric, 2);
    elsif p < winp + 0.10 then
      outc := 'breakeven'; rmul := 0;
    else
      outc := 'loss'; rmul := -1 * round((0.7 + random()*0.35)::numeric, 2);
    end if;

    insert into public.scanned_signals (
      detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, atr,
      rr_ratio, confidence_score, c_alignment, c_rr, c_symmetry, c_volatility, pattern_symmetry,
      h4_bias, h1_bias, m15_bias, qualitative_breakdown, status, resolved_outcome, resolved_r_multiple
    ) values (
      ts, inst, g, dir, round(entry,5), round(sl,5), round(t1,5), round(t2,5), round(t3,5), round(atrv,5),
      rr, conf, round(align,2), rrq, round(sym,2), round(volq,2), round(sym,2),
      h4, h1, m15, brk, case when outc = 'open' then 'active' else 'closed' end, outc, rmul
    ) returning id into sig;

    insert into public.market_context (signal_id, trading_session, volatility_index, time_of_day, day_of_week)
    values (sig, sess, round((volq/2 + random()*20)::numeric, 2), hr, extract(dow from ts)::int);
  end loop;
end $$;