SELECT cron.schedule(
  'ingest-market-context',
  '25 4 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/cron/ingest-market-context',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 25000
  );
  $$
);