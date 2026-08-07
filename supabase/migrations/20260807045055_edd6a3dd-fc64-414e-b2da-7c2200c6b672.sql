select cron.unschedule('purge-cancelled-accounts');

select cron.schedule(
  'purge-cancelled-accounts',
  '20 3 * * *',
  $$
  select net.http_post(
    url := (select worker_base_url from private.scanner_config where id) || '/api/public/cron/purge-accounts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select cron_secret from private.scanner_config where id)
    ),
    body := '{"source":"pg_cron"}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);