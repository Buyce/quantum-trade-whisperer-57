-- Align broker_trade_evidence.stop_source with the broker-derived provenance
-- emitted by src/lib/evidence/associate.ts.
--
-- The original constraint predates broker-position stop capture and only allowed
-- broker_order/planned_submitted/unavailable. Reconciliation now deliberately
-- distinguishes a stop held on the live broker position, a stop reported on the
-- broker order, an explicit broker report of no stop, and an unreadable/unknown
-- source. Keep the constraint fail-closed to exactly those canonical values.

ALTER TABLE public.broker_trade_evidence
  DROP CONSTRAINT IF EXISTS broker_trade_evidence_stop_source_check;

ALTER TABLE public.broker_trade_evidence
  ADD CONSTRAINT broker_trade_evidence_stop_source_check
  CHECK (
    stop_source IS NULL
    OR stop_source IN (
      'broker_position',
      'broker_order',
      'broker_reported_none',
      'unknown'
    )
  );
