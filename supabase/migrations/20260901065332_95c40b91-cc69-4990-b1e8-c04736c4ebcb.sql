ALTER TABLE public.broker_trade_evidence
  ADD COLUMN IF NOT EXISTS published_entry numeric,
  ADD COLUMN IF NOT EXISTS slippage_price numeric,
  ADD COLUMN IF NOT EXISTS slippage_availability text;

COMMENT ON COLUMN public.broker_trade_evidence.published_entry IS 'Entry price P-Trades published for the setup, copied from the surviving delivery row. NULL when that record is gone.';
COMMENT ON COLUMN public.broker_trade_evidence.slippage_price IS 'Signed so positive means the broker filled worse than the published entry. Never estimated.';
COMMENT ON COLUMN public.broker_trade_evidence.slippage_availability IS 'available | unavailable_no_submitted_record | unavailable_no_fill';

CREATE OR REPLACE FUNCTION public.enforce_evidence_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ignored text[] := ARRAY['published_entry', 'slippage_price', 'slippage_availability', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'broker_trade_evidence rows are immutable evidence and cannot be deleted';
  END IF;
  IF OLD.state = 'closed' THEN
    -- Closed evidence stays immutable. The single exception is a one-time fill of
    -- the slippage fields, which may only move from unset to set.
    IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
      RAISE EXCEPTION 'closed broker evidence is immutable';
    END IF;
    IF OLD.slippage_availability IS NOT NULL THEN
      RAISE EXCEPTION 'closed broker evidence slippage is already recorded and immutable';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

UPDATE public.broker_trade_evidence e
   SET published_entry = d.published_entry,
       slippage_price = CASE
         WHEN e.entry_price IS NULL OR d.published_entry IS NULL THEN NULL
         WHEN e.direction = 'short' THEN d.published_entry - e.entry_price
         ELSE e.entry_price - d.published_entry
       END,
       slippage_availability = CASE
         WHEN e.entry_price IS NULL THEN 'unavailable_no_fill'
         WHEN d.published_entry IS NULL THEN 'unavailable_no_submitted_record'
         ELSE 'available'
       END
  FROM public.execution_deliveries d
 WHERE e.delivery_id = d.id
   AND e.slippage_availability IS NULL;

UPDATE public.broker_trade_evidence
   SET slippage_availability = 'unavailable_no_submitted_record'
 WHERE slippage_availability IS NULL
   AND delivery_id IS NULL;