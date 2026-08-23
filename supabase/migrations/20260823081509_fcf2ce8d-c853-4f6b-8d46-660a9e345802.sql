-- Prompt 14 Stage 3/4 closure patch

-- 1. Benchmark auto-execution gate (defaults OFF).
ALTER TABLE public.execution_controls
  ADD COLUMN IF NOT EXISTS benchmark_auto_enabled boolean NOT NULL DEFAULT false;

-- 2. Benchmark deliveries belong to P-Trades itself, not to a trader.
ALTER TABLE public.execution_deliveries ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.execution_deliveries
  DROP CONSTRAINT IF EXISTS execution_deliveries_destination_type_check;
ALTER TABLE public.execution_deliveries
  ADD CONSTRAINT execution_deliveries_destination_type_check
  CHECK (destination_type IN ('bridge_json','metaapi_direct','metaapi_benchmark'));

ALTER TABLE public.execution_deliveries
  DROP CONSTRAINT IF EXISTS execution_deliveries_destination_account_check;
ALTER TABLE public.execution_deliveries
  ADD CONSTRAINT execution_deliveries_destination_account_check
  CHECK (
    (destination_type = 'metaapi_direct' AND connected_account_id IS NOT NULL AND user_id IS NOT NULL)
    OR (destination_type = 'bridge_json' AND connected_account_id IS NULL AND user_id IS NOT NULL)
    OR (destination_type = 'metaapi_benchmark' AND connected_account_id IS NULL AND user_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS execution_deliveries_benchmark_once
  ON public.execution_deliveries (signal_id)
  WHERE destination_type = 'metaapi_benchmark';

-- 3. Evidence governance: stop provenance source, broker account type,
--    reconciliation stamp, and benchmark evidence with no owning trader.
ALTER TABLE public.broker_trade_evidence
  ADD COLUMN IF NOT EXISTS stop_source text
    CHECK (stop_source IS NULL OR stop_source IN ('broker_order','planned_submitted','unavailable')),
  ADD COLUMN IF NOT EXISTS broker_account_type text,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;

ALTER TABLE public.broker_trade_evidence ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.broker_trade_evidence
  DROP CONSTRAINT IF EXISTS broker_trade_evidence_owner_check;
ALTER TABLE public.broker_trade_evidence
  ADD CONSTRAINT broker_trade_evidence_owner_check
  CHECK (evidence_class = 'benchmark' OR user_id IS NOT NULL);