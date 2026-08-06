alter table public.scanned_signals replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'scanned_signals'
  ) then
    execute 'alter publication supabase_realtime add table public.scanned_signals';
  end if;
end $$;