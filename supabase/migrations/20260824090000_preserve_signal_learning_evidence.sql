-- Keep the interactive feed bounded without destroying the system-generated
-- evidence needed to reproduce scanner and replay claims.
--
-- Privacy boundary: this archive contains only scanned_signals and
-- market_context rows.  It deliberately excludes executed_trades,
-- signal_user_telemetry, connected accounts and every user identifier.  It is
-- evidence storage, not an automatically promoted predictive-model input.
CREATE TABLE IF NOT EXISTS public.signal_retention_archive (
  signal_id uuid PRIMARY KEY,
  signal_snapshot jsonb NOT NULL,
  market_context_snapshot jsonb,
  shadow_execution_id uuid,
  model_version smallint NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archive_reason text NOT NULL DEFAULT 'feed_retention',
  CONSTRAINT signal_retention_archive_signal_object_chk
    CHECK (jsonb_typeof(signal_snapshot) = 'object'),
  CONSTRAINT signal_retention_archive_context_object_chk
    CHECK (
      market_context_snapshot IS NULL
      OR jsonb_typeof(market_context_snapshot) = 'object'
    ),
  CONSTRAINT signal_retention_archive_reason_chk
    CHECK (archive_reason = 'feed_retention')
);

COMMENT ON TABLE public.signal_retention_archive IS
  'Service-only immutable snapshots of system-generated scanner evidence removed from the short user-facing feed. Contains no user identifiers and is not, by itself, a promoted model cohort.';

ALTER TABLE public.signal_retention_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.signal_retention_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.signal_retention_archive TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_signal_retention_archive_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'signal retention evidence is immutable';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_signal_retention_archive_mutation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS signal_retention_archive_immutable_trg
  ON public.signal_retention_archive;
CREATE TRIGGER signal_retention_archive_immutable_trg
  BEFORE UPDATE OR DELETE ON public.signal_retention_archive
  FOR EACH ROW EXECUTE FUNCTION public.prevent_signal_retention_archive_mutation();

-- A signal may leave the feed only after the shadow worker has copied its
-- complete replay geometry.  A pending/in-flight/ambiguous delivery keeps its
-- parent signal until an operator resolves that delivery state.  The archive
-- insert and feed deletion occur in one database statement, so a purge cannot
-- create an unarchived gap.
CREATE OR REPLACE FUNCTION public.purge_expired_signals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  total_deleted integer;
BEGIN
  WITH to_purge AS (
    SELECT s.*
      FROM public.scanned_signals s
     WHERE s.status = 'expired'
       AND (
         (s.grade = 'C' AND s.detected_at < now() - interval '24 hours')
         OR (s.grade = 'B' AND s.detected_at < now() - interval '36 hours')
         OR (s.grade IN ('A', 'A+') AND s.detected_at < now() - interval '48 hours')
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.executed_trades t
          WHERE t.signal_id = s.id
            AND t.user_decision = 'taken'
       )
       AND EXISTS (
         SELECT 1
           FROM public.shadow_executions se
          WHERE se.signal_id = s.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.execution_deliveries d
          WHERE d.signal_id = s.id
            AND d.state IN ('pending', 'claimed', 'sent', 'unknown')
       )
  ),
  archived AS (
    INSERT INTO public.signal_retention_archive (
      signal_id,
      signal_snapshot,
      market_context_snapshot,
      shadow_execution_id,
      model_version
    )
    SELECT p.id,
           to_jsonb(p),
           (
             SELECT to_jsonb(mc)
               FROM public.market_context mc
              WHERE mc.signal_id = p.id
              LIMIT 1
           ),
           (
             SELECT se.id
               FROM public.shadow_executions se
              WHERE se.signal_id = p.id
              LIMIT 1
           ),
           p.model_version
      FROM to_purge p
    ON CONFLICT (signal_id) DO NOTHING
    RETURNING signal_id
  ),
  archive_ready AS (
    SELECT signal_id FROM archived
    UNION
    SELECT p.id
      FROM to_purge p
      JOIN public.signal_retention_archive a ON a.signal_id = p.id
  ),
  deleted_signals AS (
    DELETE FROM public.scanned_signals s
     WHERE s.id IN (SELECT signal_id FROM archive_ready)
    RETURNING s.id
  )
  SELECT count(*) INTO total_deleted FROM deleted_signals;

  RETURN total_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_signals()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_signals() TO service_role;
