create or replace function public.get_admin_scan_results_recent()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
set statement_timeout to '3000ms'
as $function$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'window_hours', 3,
    'total', count(*),
    'results', coalesce(
      (select jsonb_object_agg(coalesce(result, 'unknown'), c)
         from (select result, count(*) c
                 from scan_queue
                where enqueued_at > now() - interval '3 hours'
                group by result) t),
      '{}'::jsonb)
  ) into v
  from scan_queue
  where enqueued_at > now() - interval '3 hours';

  return v;
end;
$function$;

revoke all on function public.get_admin_scan_results_recent() from public;
grant execute on function public.get_admin_scan_results_recent() to authenticated;