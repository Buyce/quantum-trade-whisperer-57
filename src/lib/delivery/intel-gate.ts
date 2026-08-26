/**
 * OPTIONAL intelligence gate on AUTOMATIC ORDERS ONLY.
 *
 * Pure, browser-safe, and deliberately reduce-only: this module can refuse an
 * automatic order, and can do nothing else. It never touches publication,
 * grading, the feed, alerts, replay, shadow enrolment or any statistic — the
 * learning layer stays descriptive everywhere else in the product.
 *
 * Two honesty rules are binding:
 *  1. A thin or absent sample NEVER authorises an order while the gate is on.
 *     The refusal says the sample was insufficient; it never implies a forecast.
 *  2. The rate compared is the replay-derived P(win | filled) at the tier that
 *     actually answered, with the sample size behind it. No number is invented,
 *     smoothed further, or converted into a probability of profit.
 */
import { lookupRegime, type RegimePrior, type RegimeStatRow } from "@/lib/learning/regime";

export interface IntelGateSettings {
  /** Off by default. While false the gate is not consulted at all. */
  enabled: boolean;
  /** Minimum replay win-if-filled rate, as a percentage (0–100). */
  minWinPct: number | null;
  /** Minimum filled samples that must sit behind the rate. */
  minSample: number;
  /**
   * Owner opt-in (off by default): a regime with too FEW resolved samples is
   * allowed through instead of refused. A MEASURED rate below the threshold is
   * still refused — this option only changes what happens when there is nothing
   * to measure, and it never implies a forecast.
   */
  allowUnmeasured?: boolean;
}

export interface IntelGateQuery {
  instrument: string;
  direction: string;
  session: string;
  volatilityIndex: number | null;
}

export type IntelGateReason =
  | "gate_disabled"
  | "gate_passed"
  | "intelligence_gate_sample_insufficient"
  | "intelligence_gate_unmeasured_allowed"
  | "intelligence_gate_below_threshold";

export interface IntelGateVerdict {
  allowed: boolean;
  reason: IntelGateReason;
  /** The rate the gate compared, as a percentage; null when unavailable. */
  winPct: number | null;
  /** Filled samples behind that rate. */
  filledN: number | null;
  /** Which tier answered, for honest reporting. Null when nothing answered. */
  tier: number | null;
}

export const INTEL_GATE_COPY: Record<IntelGateReason, string> = {
  gate_disabled: "The intelligence gate is off, so it changed nothing.",
  gate_passed: "The historical win-if-filled rate met your threshold.",
  intelligence_gate_sample_insufficient:
    "Not enough resolved replay samples behind this setup's regime to judge it, so no order was placed. This is a missing measurement, not a prediction.",
  intelligence_gate_unmeasured_allowed:
    "There are not enough resolved replay samples behind this setup's regime to judge it, and you chose to allow unmeasured setups through the gate. Nothing here predicts the outcome.",
  intelligence_gate_below_threshold:
    "The historical win-if-filled rate for this setup's regime is below the threshold you set.",
};

/**
 * A configured gate needs BOTH a threshold and a sample floor to mean anything.
 * A gate switched on without a threshold is treated as unconfigured and refuses
 * nothing, rather than silently blocking every order.
 */
export function gateConfigured(settings: IntelGateSettings): boolean {
  return (
    settings.enabled &&
    settings.minWinPct !== null &&
    Number.isFinite(settings.minWinPct) &&
    settings.minWinPct > 0
  );
}

export function evaluateIntelGate(
  settings: IntelGateSettings,
  rows: RegimeStatRow[],
  query: IntelGateQuery,
): IntelGateVerdict {
  if (!gateConfigured(settings)) {
    return { allowed: true, reason: "gate_disabled", winPct: null, filledN: null, tier: null };
  }

  const prior: RegimePrior | null = lookupRegime(rows, query);
  const minSample = Number.isFinite(settings.minSample) ? Math.max(1, settings.minSample) : 1;

  // No statistics at all, no rate, or too few filled samples behind the rate:
  // the gate refuses. An unmeasured setup is never treated as a passing one.
  if (prior === null || prior.pWin === null || prior.filledN < minSample) {
    const unmeasuredAllowed = settings.allowUnmeasured === true;
    return {
      allowed: unmeasuredAllowed,
      reason: unmeasuredAllowed
        ? "intelligence_gate_unmeasured_allowed"
        : "intelligence_gate_sample_insufficient",
      winPct: prior?.pWin === null || prior === null ? null : Number((prior.pWin * 100).toFixed(1)),
      filledN: prior?.filledN ?? null,
      tier: prior?.tier ?? null,
    };
  }

  const winPct = Number((prior.pWin * 100).toFixed(1));
  const allowed = winPct >= (settings.minWinPct as number);
  return {
    allowed,
    reason: allowed ? "gate_passed" : "intelligence_gate_below_threshold",
    winPct,
    filledN: prior.filledN,
    tier: prior.tier,
  };
}
