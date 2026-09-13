create table public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assistant_threads_user_updated_idx
  on public.assistant_threads (user_id, updated_at desc);

grant select, insert, update, delete on public.assistant_threads to authenticated;
grant all on public.assistant_threads to service_role;

alter table public.assistant_threads enable row level security;

create policy "Users manage their own assistant threads"
  on public.assistant_threads
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.assistant_threads(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  message_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  parts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (thread_id, message_id)
);

create index assistant_messages_thread_idx
  on public.assistant_messages (thread_id, created_at asc);

grant select, insert, update, delete on public.assistant_messages to authenticated;
grant all on public.assistant_messages to service_role;

alter table public.assistant_messages enable row level security;

create policy "Users manage their own assistant messages"
  on public.assistant_messages
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());