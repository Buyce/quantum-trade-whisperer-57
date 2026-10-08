-- Align broker_trade_evidence.stop_source with the broker-derived provenance
-- emitted by src/lib/evidence/associate.ts.
--
-- Normalize the two legacy values before replacing the old CHECK constraint:
--   planned_submitted -> unknown
--     The value is not broker-derived, so it must not be represented as a
--     broker-observed stop source under the current evidence contract.
--   unavailable -> unknown
--     The current canonical equivalent is an unknown broker stop source.
--
-- Existing broker_order rows remain broker_order.

ALTER TABLE public.broker_trade_evidence
  DROP CONSTRAINT IF EXISTS broker_trade_evidence_stop_source_check;

UPDATE public.broker_trade_evidence
SET stop_source = 'unknown'
WHERE stop_source IN ('planned_submitted', 'unavailable');

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
