SELECT cron.schedule(
  'verify-trade-prices-reminder',
  '30 9 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/cron/verify-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 25000
  );
  $$
);