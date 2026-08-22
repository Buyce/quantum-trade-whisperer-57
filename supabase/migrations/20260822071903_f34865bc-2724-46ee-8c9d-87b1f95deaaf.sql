-- Delivery drain + lease expiry. Every minute: bounded, separate from the scan
-- worker so a broker bridge can never delay a scan.
SELECT cron.schedule(
  'drain-execution-deliveries',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT worker_base_url FROM private.scanner_config WHERE id) || '/api/public/worker/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT cron_secret FROM private.scanner_config WHERE id)
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 20000
  );
  $cron$
);