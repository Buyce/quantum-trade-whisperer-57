create or replace function private.kick_scan_worker()
returns trigger
language plpgsql
security definer
set search_path = private, net, public
as $$
declare
  cfg private.scanner_config;
begin
  select * into cfg from private.scanner_config where id;
  if cfg is null then
    return null;
  end if;

  perform net.http_post(
    url := cfg.worker_base_url || '/api/public/worker/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cfg.cron_secret
    ),
    body := jsonb_build_object('source', 'scan_queue_trigger'),
    timeout_milliseconds := 4000
  );
  return null;
end;
$$;

revoke all on function private.kick_scan_worker() from public, anon, authenticated;