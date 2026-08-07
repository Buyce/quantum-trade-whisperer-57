alter table public.profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_scheduled_for timestamptz;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  category text not null default 'other',
  message text not null,
  contact_email text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert on public.feedback to authenticated;
grant all on public.feedback to service_role;

alter table public.feedback enable row level security;

create policy "feedback_select_own" on public.feedback
  for select to authenticated using (auth.uid() = user_id);

create policy "feedback_insert_own" on public.feedback
  for insert to authenticated with check (auth.uid() = user_id);

create trigger feedback_touch before update on public.feedback
  for each row execute function public.touch_updated_at();

create index if not exists feedback_user_created_idx on public.feedback (user_id, created_at desc);
create index if not exists profiles_deletion_scheduled_idx on public.profiles (deletion_scheduled_for)
  where deletion_scheduled_for is not null;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('purge-cancelled-accounts')
where exists (select 1 from cron.job where jobname = 'purge-cancelled-accounts');

select cron.schedule(
  'purge-cancelled-accounts',
  '20 3 * * *',
  $$
  select net.http_post(
    url := 'https://project--5d3af58e-f9f0-42a3-a7b5-a3a78b1e93c6.lovable.app/api/public/cron/purge-accounts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);