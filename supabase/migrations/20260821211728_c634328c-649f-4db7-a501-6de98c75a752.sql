-- Prompt 8/9 Stage 3 — resolved-state conflict protection + snapshot immutability.
-- Identical retries are no-ops; conflicting mutations of a resolved trade are
-- rejected. Rounding to 4dp mirrors R_DECIMALS in src/lib/journal/r-math.ts so
-- float noise cannot turn an identical retry into a "conflict".

CREATE OR REPLACE FUNCTION public.enforce_trade_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  same boolean;
BEGIN
  -- 1. Creation-time snapshot fields are immutable once set.
  IF (OLD.planned_entry IS NOT NULL AND NEW.planned_entry IS DISTINCT FROM OLD.planned_entry)
     OR (OLD.planned_stop IS NOT NULL AND NEW.planned_stop IS DISTINCT FROM OLD.planned_stop)
     OR (OLD.planned_direction IS NOT NULL AND NEW.planned_direction IS DISTINCT FROM OLD.planned_direction)
     OR (OLD.signal_detected_at IS NOT NULL AND NEW.signal_detected_at IS DISTINCT FROM OLD.signal_detected_at)
     OR (OLD.signal_instrument IS NOT NULL AND NEW.signal_instrument IS DISTINCT FROM OLD.signal_instrument)
     OR (OLD.signal_grade IS NOT NULL AND NEW.signal_grade IS DISTINCT FROM OLD.signal_grade)
     OR (OLD.signal_trading_session IS NOT NULL AND NEW.signal_trading_session IS DISTINCT FROM OLD.signal_trading_session)
     OR (OLD.signal_time_of_day IS NOT NULL AND NEW.signal_time_of_day IS DISTINCT FROM OLD.signal_time_of_day)
     OR (OLD.signal_day_of_week IS NOT NULL AND NEW.signal_day_of_week IS DISTINCT FROM OLD.signal_day_of_week)
  THEN
    RAISE EXCEPTION 'journal_snapshot_immutable'
      USING HINT = 'Creation-time plan/context snapshot fields cannot be changed.';
  END IF;

  -- 2. Legacy R provenance is frozen: never written or rewritten again.
  IF NEW.realized_r_multiple IS DISTINCT FROM OLD.realized_r_multiple
     OR NEW.derived_r IS DISTINCT FROM OLD.derived_r THEN
    RAISE EXCEPTION 'legacy_r_frozen'
      USING HINT = 'realized_r_multiple and derived_r are frozen legacy provenance.';
  END IF;

  -- 3. Resolved-state protection.
  IF OLD.outcome IS DISTINCT FROM 'open'::trade_outcome THEN
    same :=
      NEW.outcome IS NOT DISTINCT FROM OLD.outcome
      AND round(coalesce(NEW.actual_entry_price, -999999)::numeric, 4)
          = round(coalesce(OLD.actual_entry_price, -999999)::numeric, 4)
      AND round(coalesce(NEW.actual_exit_price, -999999)::numeric, 4)
          = round(coalesce(OLD.actual_exit_price, -999999)::numeric, 4)
      AND round(coalesce(NEW.actual_initial_stop, -999999)::numeric, 4)
          = round(coalesce(OLD.actual_initial_stop, -999999)::numeric, 4)
      AND round(coalesce(NEW.r_vs_plan, -999999)::numeric, 4)
          = round(coalesce(OLD.r_vs_plan, -999999)::numeric, 4)
      AND round(coalesce(NEW.r_vs_actual_risk, -999999)::numeric, 4)
          = round(coalesce(OLD.r_vs_actual_risk, -999999)::numeric, 4)
      AND NEW.r_availability IS NOT DISTINCT FROM OLD.r_availability
      AND NEW.stop_provenance IS NOT DISTINCT FROM OLD.stop_provenance
      AND NEW.price_source IS NOT DISTINCT FROM OLD.price_source;

    IF NOT same THEN
      RAISE EXCEPTION 'trade_already_resolved'
        USING HINT = 'A resolved trade only accepts identical retries. Use a correction workflow to change it.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_trade_resolution_trg ON public.executed_trades;
CREATE TRIGGER enforce_trade_resolution_trg
  BEFORE UPDATE ON public.executed_trades
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trade_resolution();