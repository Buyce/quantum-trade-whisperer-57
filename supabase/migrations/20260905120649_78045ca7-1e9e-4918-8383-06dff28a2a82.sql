-- Minimal, in-place repair: the only faulty statement inside
-- recompute_filter_lift is an unqualified DELETE, which the project's
-- safe-update guard rejects ("DELETE requires a WHERE clause"), aborting the
-- hourly filter-evidence rebuild. Rewrite that one statement and nothing else,
-- by patching the function's own stored definition.
DO $do$
DECLARE
  src text;
  patched text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'recompute_filter_lift';

  IF src IS NULL THEN
    RAISE EXCEPTION 'recompute_filter_lift not found';
  END IF;

  patched := replace(src,
    'DELETE FROM filter_lift_stats;',
    'DELETE FROM filter_lift_stats WHERE true;');

  IF patched = src THEN
    RAISE EXCEPTION 'expected unqualified DELETE not found; refusing to change the function';
  END IF;

  EXECUTE patched;
END
$do$;