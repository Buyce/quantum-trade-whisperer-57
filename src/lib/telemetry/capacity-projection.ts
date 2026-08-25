/**
 * Provider-capacity projection (Wave 2).
 *
 * Adding four instruments is not free: every one adds quote samples, candle reads,
 * a daily specification refresh, conversion checks and readiness snapshots. The
 * existing telemetry already has a daily request budget, and activating a new asset
 * class without checking that budget is how the whole scanner gets rate-limited —
 * a Wave 2 experiment must never be able to degrade Wave 0.
 *
 * The projection is arithmetic on the CURRENT configuration, not an estimate: slots
 * per day come from the sampler cadence, and each per-instrument cost is stated.
 */
import { SAMPLER_INTERVAL_MS } from "./sampler";

export interface PerInstrumentCost {
  /** One quote per sampler slot. */
  samplerQuotes: number;
  /** Candle reads per day from the scan cadence, per timeframe fetched. */
  candleReads: number;
  /** Specification refresh, at most once per 24h. */
  specRefreshes: number;
  /** Conversion-leg quotes proved during readiness. */
  conversionQuotes: number;
  /** Readiness snapshots per day. */
  readinessSnapshots: number;
}

export function perInstrumentCost(args: {
  scansPerDay: number;
  timeframes: number;
  conversionLegs: number;
  intervalMs?: number;
}): PerInstrumentCost {
  const slots = Math.floor((24 * 3_600_000) / (args.intervalMs ?? SAMPLER_INTERVAL_MS));
  return {
    samplerQuotes: slots,
    candleReads: args.scansPerDay * args.timeframes,
    specRefreshes: 1,
    conversionQuotes: args.conversionLegs,
    readinessSnapshots: 1,
  };
}

export function costTotal(cost: PerInstrumentCost): number {
  return (
    cost.samplerQuotes +
    cost.candleReads +
    cost.specRefreshes +
    cost.conversionQuotes +
    cost.readinessSnapshots
  );
}

export interface CapacityVerdict {
  currentRequestsPerDay: number;
  incrementalRequestsPerDay: number;
  projectedRequestsPerDay: number;
  budget: number;
  headroom: number;
  /** False means the activation is REFUSED, not "monitor and see". */
  withinBudget: boolean;
  reason: string | null;
}

/**
 * Project the cost of activating `newInstruments` and decide whether it fits.
 *
 * A projection that exactly equals the budget is refused: a budget with zero
 * headroom has no room for a retry, and retries are normal.
 */
export function projectCapacity(args: {
  currentInstruments: number;
  newInstruments: number;
  budget: number;
  cost: PerInstrumentCost;
  /** Fraction of the budget that must stay free for retries. Default 10%. */
  reserveFraction?: number;
}): CapacityVerdict {
  const per = costTotal(args.cost);
  const current = args.currentInstruments * per;
  const incremental = args.newInstruments * per;
  const projected = current + incremental;
  const reserve = Math.ceil(args.budget * (args.reserveFraction ?? 0.1));
  const usable = args.budget - reserve;
  const headroom = usable - projected;

  return {
    currentRequestsPerDay: current,
    incrementalRequestsPerDay: incremental,
    projectedRequestsPerDay: projected,
    budget: args.budget,
    headroom,
    withinBudget: headroom > 0,
    reason:
      headroom > 0
        ? null
        : `projected ${projected} requests/day exceeds the usable budget of ${usable} (${args.budget} less a ${reserve} retry reserve)`,
  };
}
