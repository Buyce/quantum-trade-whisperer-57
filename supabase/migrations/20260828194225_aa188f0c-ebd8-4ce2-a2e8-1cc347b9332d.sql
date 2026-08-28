ALTER TABLE public.execution_deliveries
  ADD COLUMN IF NOT EXISTS broker_order_state text,
  ADD COLUMN IF NOT EXISTS broker_state_at timestamp with time zone;

ALTER TABLE public.execution_deliveries
  DROP CONSTRAINT IF EXISTS execution_deliveries_broker_order_state_check;
ALTER TABLE public.execution_deliveries
  ADD CONSTRAINT execution_deliveries_broker_order_state_check
  CHECK (broker_order_state IS NULL OR broker_order_state IN
    ('resting', 'open', 'closed', 'cancelled', 'absent', 'unresolved'));

CREATE TABLE IF NOT EXISTS public.broker_order_associations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_id bigint NOT NULL,
  user_id uuid NOT NULL,
  connected_account_id uuid,
  signal_id uuid,
  client_id text,
  magic integer,
  broker_order_id text,
  broker_symbol text,
  submitted_entry numeric,
  submitted_stop numeric,
  submitted_target numeric,
  submitted_at timestamp with time zone,
  account_mode text,
  destination_type text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT broker_order_associations_delivery_unique UNIQUE (delivery_id)
);

GRANT ALL ON public.broker_order_associations TO service_role;
ALTER TABLE public.broker_order_associations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages broker order associations"
  ON public.broker_order_associations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER broker_order_associations_touch
  BEFORE UPDATE ON public.broker_order_associations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.snapshot_broker_order_association()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.broker_order_id IS NULL AND NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.broker_order_associations (
    delivery_id, user_id, connected_account_id, signal_id, client_id, magic,
    broker_order_id, broker_symbol, submitted_entry, submitted_stop,
    submitted_target, submitted_at, account_mode, destination_type
  ) VALUES (
    NEW.id, NEW.user_id, NEW.connected_account_id, NEW.signal_id, NEW.client_id,
    NEW.magic, NEW.broker_order_id, NEW.broker_symbol, NEW.submitted_entry,
    NEW.submitted_stop, NEW.submitted_target, NEW.submitted_at, NEW.account_mode,
    NEW.destination_type
  )
  ON CONFLICT (delivery_id) DO UPDATE
    SET broker_order_id = COALESCE(EXCLUDED.broker_order_id, public.broker_order_associations.broker_order_id),
        client_id = COALESCE(EXCLUDED.client_id, public.broker_order_associations.client_id),
        broker_symbol = COALESCE(EXCLUDED.broker_symbol, public.broker_order_associations.broker_symbol),
        submitted_entry = COALESCE(EXCLUDED.submitted_entry, public.broker_order_associations.submitted_entry),
        submitted_stop = COALESCE(EXCLUDED.submitted_stop, public.broker_order_associations.submitted_stop),
        submitted_target = COALESCE(EXCLUDED.submitted_target, public.broker_order_associations.submitted_target),
        submitted_at = COALESCE(EXCLUDED.submitted_at, public.broker_order_associations.submitted_at),
        account_mode = COALESCE(EXCLUDED.account_mode, public.broker_order_associations.account_mode),
        destination_type = COALESCE(EXCLUDED.destination_type, public.broker_order_associations.destination_type);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS execution_deliveries_snapshot_association ON public.execution_deliveries;
CREATE TRIGGER execution_deliveries_snapshot_association
  AFTER INSERT OR UPDATE OF broker_order_id, client_id, submitted_at
  ON public.execution_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_broker_order_association();

INSERT INTO public.broker_order_associations (
  delivery_id, user_id, connected_account_id, signal_id, client_id, magic,
  broker_order_id, broker_symbol, submitted_entry, submitted_stop,
  submitted_target, submitted_at, account_mode, destination_type
)
SELECT d.id, d.user_id, d.connected_account_id, d.signal_id, d.client_id, d.magic,
       d.broker_order_id, d.broker_symbol, d.submitted_entry, d.submitted_stop,
       d.submitted_target, d.submitted_at, d.account_mode, d.destination_type
  FROM public.execution_deliveries d
 WHERE d.broker_order_id IS NOT NULL OR d.client_id IS NOT NULL
ON CONFLICT (delivery_id) DO NOTHING;

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
            AND (
              d.state IN ('pending', 'claimed', 'sent', 'unknown', 'acknowledged')
              OR (
                d.broker_order_id IS NOT NULL
                AND (
                  d.broker_order_state IS NULL
                  OR d.broker_order_state IN ('resting', 'open', 'unresolved')
                )
              )
            )
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