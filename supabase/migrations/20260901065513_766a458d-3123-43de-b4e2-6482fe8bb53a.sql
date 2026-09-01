ALTER TABLE public.broker_trade_evidence
  ADD COLUMN IF NOT EXISTS slippage_basis text;

COMMENT ON COLUMN public.broker_trade_evidence.slippage_basis IS 'published | submitted — which recorded price the slippage figure was measured against. NULL when slippage is unavailable.';

CREATE OR REPLACE FUNCTION public.enforce_evidence_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ignored text[] := ARRAY['published_entry', 'slippage_price', 'slippage_availability', 'slippage_basis', 'updated_at'];
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
    IF OLD.slippage_price IS NOT NULL THEN
      RAISE EXCEPTION 'closed broker evidence slippage is already recorded and immutable';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

UPDATE public.broker_trade_evidence e
   SET published_entry = COALESCE(d.published_entry, d.submitted_entry),
       slippage_basis = CASE
         WHEN d.published_entry IS NOT NULL THEN 'published'
         WHEN d.submitted_entry IS NOT NULL THEN 'submitted'
         ELSE NULL
       END,
       slippage_price = CASE
         WHEN e.entry_price IS NULL OR COALESCE(d.published_entry, d.submitted_entry) IS NULL THEN NULL
         WHEN e.direction = 'short' THEN COALESCE(d.published_entry, d.submitted_entry) - e.entry_price
         ELSE e.entry_price - COALESCE(d.published_entry, d.submitted_entry)
       END,
       slippage_availability = CASE
         WHEN e.entry_price IS NULL THEN 'unavailable_no_fill'
         WHEN COALESCE(d.published_entry, d.submitted_entry) IS NULL THEN 'unavailable_no_submitted_record'
         ELSE 'available'
       END
  FROM public.execution_deliveries d
 WHERE e.delivery_id = d.id
   AND e.slippage_price IS NULL;