-- Permanent archive of expired setups plus lineage stamps, so retention clean-up
-- can never destroy the record a learning row was derived from.

CREATE TABLE IF NOT EXISTS public.signal_retention_archive (
  signal_id uuid PRIMARY KEY,
  archived_at timestamptz NOT NULL DEFAULT now(),
  instrument text,
  grade text,
  direction text,
  detected_at timestamptz,
  model_version smallint,
  shadow_execution_id uuid,
  signal_snapshot jsonb NOT NULL,
  market_context_snapshot jsonb,
  related_snapshots jsonb
);

COMMENT ON TABLE public.signal_retention_archive IS
  'Immutable copy of every scanned_signals row removed by purge_expired_signals(), including its market context and cascade-deleted children. Training and learning rows keep their thread to a purged setup through archived_signal_id on shadow_executions, model_observations, research_candidates and sizing_divergence_log.';

GRANT ALL ON public.signal_retention_archive TO service_role;
GRANT SELECT ON public.signal_retention_archive TO authenticated;

ALTER TABLE public.signal_retention_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "archive_owner_read" ON public.signal_retention_archive;
CREATE POLICY "archive_owner_read"
ON public.signal_retention_archive
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE INDEX IF NOT EXISTS signal_retention_archive_detected_idx
  ON public.signal_retention_archive (detected_at DESC);

-- Immutability: the archive is evidence, so it is insert-only.
CREATE OR REPLACE FUNCTION public.enforce_archive_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'signal_retention_archive is insert-only';
END;
$$;

DROP TRIGGER IF EXISTS signal_retention_archive_immutable ON public.signal_retention_archive;
CREATE TRIGGER signal_retention_archive_immutable
BEFORE UPDATE OR DELETE ON public.signal_retention_archive
FOR EACH ROW EXECUTE FUNCTION public.enforce_archive_immutability();

-- Lineage stamps. These carry no foreign key on purpose: they must survive the
-- deletion of the setup row and point into the archive instead.
ALTER TABLE public.shadow_executions   ADD COLUMN IF NOT EXISTS archived_signal_id uuid;
ALTER TABLE public.model_observations  ADD COLUMN IF NOT EXISTS archived_signal_id uuid;
ALTER TABLE public.research_candidates ADD COLUMN IF NOT EXISTS archived_signal_id uuid;
ALTER TABLE public.sizing_divergence_log ADD COLUMN IF NOT EXISTS archived_signal_id uuid;

COMMENT ON COLUMN public.shadow_executions.archived_signal_id IS
  'Setup id this replay came from after retention clean-up removed the setup row. Resolve it in signal_retention_archive.';
COMMENT ON COLUMN public.model_observations.archived_signal_id IS
  'Setup id this observation came from after retention clean-up removed the setup row. Resolve it in signal_retention_archive.';
COMMENT ON COLUMN public.research_candidates.archived_signal_id IS
  'Published setup id this candidate produced after retention clean-up removed the setup row. Resolve it in signal_retention_archive.';
COMMENT ON COLUMN public.sizing_divergence_log.archived_signal_id IS
  'Setup id this sizing comparison came from after retention clean-up removed the setup row. Resolve it in signal_retention_archive.';

-- Clean-up routine: archive first (setup, market context, cascade-deleted
-- children), stamp lineage onto learning rows, only then delete the setup.
CREATE OR REPLACE FUNCTION public.purge_expired_signals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  total_deleted integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _purge_ids (signal_id uuid PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _purge_ids;

  INSERT INTO _purge_ids (signal_id)
  SELECT s.id
    FROM public.scanned_signals s
   WHERE s.status = 'expired'
     AND (
       (s.grade = 'C' AND s.detected_at < now() - interval '24 hours')
       OR (s.grade = 'B' AND s.detected_at < now() - interval '36 hours')
       OR (s.grade IN ('A', 'A+') AND s.detected_at < now() - interval '48 hours')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.executed_trades t
        WHERE t.signal_id = s.id AND t.user_decision = 'taken'
     )
     -- Only remove a setup whose replay outcome is already recorded: the replay
     -- row is the learning artefact, the setup row is just the feed entry.
     AND EXISTS (
       SELECT 1 FROM public.shadow_executions se WHERE se.signal_id = s.id
     )
     -- A delivery that ever reached a broker is permanent evidence: without it
     -- a filled, closed broker trade can never be associated back to P-Trades.
     AND NOT EXISTS (
       SELECT 1 FROM public.execution_deliveries d
        WHERE d.signal_id = s.id
          AND (
            d.state IN ('pending', 'claimed', 'sent', 'unknown', 'acknowledged')
            OR d.client_id IS NOT NULL
            OR d.submitted_at IS NOT NULL
            OR d.broker_order_id IS NOT NULL
          )
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.broker_trade_evidence e WHERE e.signal_id = s.id
     );

  INSERT INTO public.signal_retention_archive (
    signal_id,
    instrument,
    grade,
    direction,
    detected_at,
    model_version,
    shadow_execution_id,
    signal_snapshot,
    market_context_snapshot,
    related_snapshots
  )
  SELECT s.id,
         s.instrument,
         s.grade::text,
         s.direction::text,
         s.detected_at,
         s.model_version,
         (SELECT se.id FROM public.shadow_executions se WHERE se.signal_id = s.id LIMIT 1),
         to_jsonb(s),
         (SELECT to_jsonb(mc) FROM public.market_context mc WHERE mc.signal_id = s.id LIMIT 1),
         jsonb_build_object(
           'executed_trades',
           COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.executed_trades t WHERE t.signal_id = s.id), '[]'::jsonb),
           'signal_user_telemetry',
           COALESCE((SELECT jsonb_agg(to_jsonb(ut)) FROM public.signal_user_telemetry ut WHERE ut.signal_id = s.id), '[]'::jsonb),
           'execution_deliveries',
           COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM public.execution_deliveries d WHERE d.signal_id = s.id), '[]'::jsonb)
         )
    FROM public.scanned_signals s
    JOIN _purge_ids p ON p.signal_id = s.id
  ON CONFLICT (signal_id) DO NOTHING;

  -- Nothing is deleted unless the archive row exists.
  DELETE FROM _purge_ids p
   WHERE NOT EXISTS (
     SELECT 1 FROM public.signal_retention_archive a WHERE a.signal_id = p.signal_id
   );

  UPDATE public.shadow_executions se
     SET archived_signal_id = se.signal_id
    FROM _purge_ids p
   WHERE se.signal_id = p.signal_id;

  UPDATE public.model_observations mo
     SET archived_signal_id = mo.signal_id
    FROM _purge_ids p
   WHERE mo.signal_id = p.signal_id;

  UPDATE public.research_candidates rc
     SET archived_signal_id = rc.published_signal_id
    FROM _purge_ids p
   WHERE rc.published_signal_id = p.signal_id;

  UPDATE public.sizing_divergence_log sd
     SET archived_signal_id = sd.signal_id
    FROM _purge_ids p
   WHERE sd.signal_id = p.signal_id;

  WITH deleted_signals AS (
    DELETE FROM public.scanned_signals s
     WHERE s.id IN (SELECT signal_id FROM _purge_ids)
    RETURNING s.id
  )
  SELECT count(*) INTO total_deleted FROM deleted_signals;

  RETURN total_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_signals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_signals() TO service_role;

-- Owner-visible health of the retention clean-up jobs, so a silent failure like
-- the missing archive table cannot go unnoticed again.
CREATE OR REPLACE FUNCTION public.get_admin_cleanup_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  SELECT jsonb_build_object(
    'archived_signals', (SELECT count(*) FROM public.signal_retention_archive),
    'archived_last_at', (SELECT max(archived_at) FROM public.signal_retention_archive),
    'live_signals', (SELECT count(*) FROM public.scanned_signals),
    'jobs', COALESCE((
      SELECT jsonb_agg(j ORDER BY j->>'job')
        FROM (
          SELECT jsonb_build_object(
                   'job', job.jobname,
                   'schedule', job.schedule,
                   'active', job.active,
                   'last_run_at', run.start_time,
                   'last_status', run.status,
                   'last_message', left(COALESCE(run.return_message, ''), 400)
                 ) AS j
            FROM cron.job job
            LEFT JOIN LATERAL (
              SELECT d.start_time, d.status, d.return_message
                FROM cron.job_run_details d
               WHERE d.jobid = job.jobid
               ORDER BY d.start_time DESC
               LIMIT 1
            ) run ON true
           WHERE job.jobname IN (
             'purge-expired-signals',
             'telemetry-rollup',
             'purge-cancelled-accounts'
           )
        ) s
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_admin_cleanup_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_cleanup_health() TO authenticated, service_role;