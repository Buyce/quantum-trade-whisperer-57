/**
 * OPTIONAL intelligence gate on AUTOMATIC ORDERS ONLY.
 *
 * Pure, browser-safe, and deliberately reduce-only: this module can refuse an
 * automatic order, and can do nothing else. It never touches publication,
 * grading, the feed, alerts, replay, shadow enrolment or any statistic — the
 * learning layer stays descriptive everywhere else in the product.
 *
 * Two measures, both replay-derived, both optional and independent:
 *  - EXPECTED R per published plan (`payoff_stats.mean_r_per_plan`). This is the
 *    money measure: it averages the whole payoff distribution and counts plans
 *    that never traded as exactly 0R. A cohort passes only when its mean clears
 *    the owner's floor AND its confidence interval does not sit entirely below
 *    zero.
 *  - WIN-IF-FILLED rate (`regime_stats.p_win_shrunk`). A hit-rate measure only:
 *    it says nothing about how much is won or lost per trade, so it is kept as a
 *    secondary filter rather than the primary one.
 *
 * Two honesty rules are binding:
 *  1. A thin or absent sample NEVER authorises an order while the gate is on.
 *     The refusal says the sample was insufficient; it never implies a forecast.
 *  2. Every number reported is the measured value at the tier that actually
 *     answered, with the sample size behind it. Nothing is invented, smoothed
 *     further, or converted into a probability of profit.
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
   * Minimum expected R per published plan the cohort must have measured. Null
   * means this leg is not configured and refuses nothing.
   */
  minExpectedR?: number | null;
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

/**
 * The per-plan expected-R cohort rows the gate is allowed to read. Only
 * `mean_r_per_plan` rows whose statistics are reportable ever reach here; a
 * cohort still labelled thin or unresolved is treated as unmeasured.
 */
export interface PayoffGateRow {
  tier: number;
  instrument: string | null;
  direction: string | null;
  estimand: string;
  stat_status: string;
  n_used: number | null;
  mean_r: number | null;
  ci_lo: number | null;
  ci_hi: number | null;
}

export interface PayoffGateCohort {
  tier: number;
  meanR: number;
  nUsed: number;
  ciLo: number | null;
  ciHi: number | null;
}

export type IntelGateReason =
  | "gate_disabled"
  | "gate_passed"
  | "intelligence_gate_sample_insufficient"
  | "intelligence_gate_unmeasured_allowed"
  | "intelligence_gate_below_threshold"
  | "intelligence_gate_expected_r_unmeasured"
  | "intelligence_gate_expected_r_below_threshold"
  | "intelligence_gate_expected_r_interval_below_zero";

export interface IntelGateVerdict {
  allowed: boolean;
  reason: IntelGateReason;
  /** The rate the gate compared, as a percentage; null when unavailable. */
  winPct: number | null;
  /** Filled samples behind that rate. */
  filledN: number | null;
  /** Which tier answered, for honest reporting. Null when nothing answered. */
  tier: number | null;
  /** Measured expected R per plan the gate compared; null when unavailable. */
  expectedR: number | null;
  /** Plans behind that expected R; null when unavailable. */
  expectedRN: number | null;
  /** Which payoff tier answered; null when nothing answered. */
  expectedRTier: number | null;
  /** Interval around the expected R, as measured. Null when unavailable. */
  expectedRCiLo: number | null;
  expectedRCiHi: number | null;
}

export const INTEL_GATE_COPY: Record<IntelGateReason, string> = {
  gate_disabled: "The intelligence gate is off, so it changed nothing.",
  gate_passed: "This setup's cohort met every threshold you set.",
  intelligence_gate_sample_insufficient:
    "Not enough resolved replay samples behind this setup's regime to judge it, so no order was placed. This is a missing measurement, not a prediction.",
  intelligence_gate_unmeasured_allowed:
    "There are not enough resolved replay samples behind this setup's regime to judge it, and you chose to allow unmeasured setups through the gate. Nothing here predicts the outcome.",
  intelligence_gate_below_threshold:
    "The historical win-if-filled rate for this setup's regime is below the threshold you set.",
  intelligence_gate_expected_r_unmeasured:
    "No reportable expected-R measurement exists for this setup's cohort yet, so no order was placed. This is a missing measurement, not a prediction.",
  intelligence_gate_expected_r_below_threshold:
    "The measured expected return per setup for this cohort is below the floor you set.",
  intelligence_gate_expected_r_interval_below_zero:
    "The whole measured range for this cohort's expected return sits below zero, so the gate refused the order.",
};

/**
 * A configured gate needs at least one usable threshold. A gate switched on with
 * neither a win-rate threshold nor an expected-R floor is treated as
 * unconfigured and refuses nothing, rather than silently blocking every order.
 */
export function winGateConfigured(settings: IntelGateSettings): boolean {
  return (
    settings.enabled &&
    settings.minWinPct !== null &&
    settings.minWinPct !== undefined &&
    Number.isFinite(settings.minWinPct) &&
    settings.minWinPct > 0
  );
}

export function expectedRGateConfigured(settings: IntelGateSettings): boolean {
  return (
    settings.enabled &&
    settings.minExpectedR !== null &&
    settings.minExpectedR !== undefined &&
    Number.isFinite(settings.minExpectedR)
  );
}

export function gateConfigured(settings: IntelGateSettings): boolean {
  return winGateConfigured(settings) || expectedRGateConfigured(settings);
}

/**
 * Most specific reportable cohort first — instrument + direction, then global.
 * A row whose statistics are not reportable is skipped, never rounded up into a
 * usable number.
 */
export function lookupPayoffCohort(
  rows: PayoffGateRow[],
  query: { instrument: string; direction: string },
): PayoffGateCohort | null {
  const usable = rows.filter(
    (r) =>
      r.estimand === "mean_r_per_plan" &&
      r.stat_status === "descriptive" &&
      r.mean_r !== null &&
      Number.isFinite(Number(r.mean_r)),
  );
  const pick = (candidates: PayoffGateRow[]): PayoffGateCohort | null => {
    if (candidates.length === 0) return null;
    // Largest measured sample wins when several model/replay variants coexist.
    const best = [...candidates].sort((a, b) => (b.n_used ?? 0) - (a.n_used ?? 0))[0]!;
    return {
      tier: best.tier,
      meanR: Number(best.mean_r),
      nUsed: Number(best.n_used ?? 0),
      ciLo: best.ci_lo === null ? null : Number(best.ci_lo),
      ciHi: best.ci_hi === null ? null : Number(best.ci_hi),
    };
  };

  return (
    pick(
      usable.filter(
        (r) =>
          r.tier === 2 &&
          (r.instrument ?? "").toUpperCase() === query.instrument.toUpperCase() &&
          (r.direction ?? "").toLowerCase() === query.direction.toLowerCase(),
      ),
    ) ?? pick(usable.filter((r) => r.tier === 1))
  );
}

const EMPTY = {
  winPct: null,
  filledN: null,
  tier: null,
  expectedR: null,
  expectedRN: null,
  expectedRTier: null,
  expectedRCiLo: null,
  expectedRCiHi: null,
};

export function evaluateIntelGate(
  settings: IntelGateSettings,
  rows: RegimeStatRow[],
  query: IntelGateQuery,
  payoffRows: PayoffGateRow[] = [],
): IntelGateVerdict {
  if (!gateConfigured(settings)) {
    return { allowed: true, reason: "gate_disabled", ...EMPTY };
  }

  const unmeasuredAllowed = settings.allowUnmeasured === true;

  // ---- Expected R: the money measure, checked first when configured. ----
  let payoff: PayoffGateCohort | null = null;
  if (expectedRGateConfigured(settings)) {
    payoff = lookupPayoffCohort(payoffRows, {
      instrument: query.instrument,
      direction: query.direction,
    });
    const payoffFields = {
      expectedR: payoff === null ? null : Number(payoff.meanR.toFixed(4)),
      expectedRN: payoff?.nUsed ?? null,
      expectedRTier: payoff?.tier ?? null,
      expectedRCiLo: payoff?.ciLo ?? null,
      expectedRCiHi: payoff?.ciHi ?? null,
    };

    if (payoff === null) {
      return {
        allowed: unmeasuredAllowed,
        reason: unmeasuredAllowed
          ? "intelligence_gate_unmeasured_allowed"
          : "intelligence_gate_expected_r_unmeasured",
        winPct: null,
        filledN: null,
        tier: null,
        ...payoffFields,
      };
    }
    if (payoff.ciHi !== null && payoff.ciHi < 0) {
      return {
        allowed: false,
        reason: "intelligence_gate_expected_r_interval_below_zero",
        winPct: null,
        filledN: null,
        tier: null,
        ...payoffFields,
      };
    }
    if (payoff.meanR < (settings.minExpectedR as number)) {
      return {
        allowed: false,
        reason: "intelligence_gate_expected_r_below_threshold",
        winPct: null,
        filledN: null,
        tier: null,
        ...payoffFields,
      };
    }
  }

  const payoffFields = {
    expectedR: payoff === null ? null : Number(payoff.meanR.toFixed(4)),
    expectedRN: payoff?.nUsed ?? null,
    expectedRTier: payoff?.tier ?? null,
    expectedRCiLo: payoff?.ciLo ?? null,
    expectedRCiHi: payoff?.ciHi ?? null,
  };

  // ---- Win-if-filled: secondary hit-rate filter, only when configured. ----
  if (!winGateConfigured(settings)) {
    return { allowed: true, reason: "gate_passed", winPct: null, filledN: null, tier: null, ...payoffFields };
  }

  const prior: RegimePrior | null = lookupRegime(rows, query);
  const minSample = Number.isFinite(settings.minSample) ? Math.max(1, settings.minSample) : 1;

  // No statistics at all, no rate, or too few filled samples behind the rate:
  // the gate refuses. An unmeasured setup is never treated as a passing one.
  if (prior === null || prior.pWin === null || prior.filledN < minSample) {
    return {
      allowed: unmeasuredAllowed,
      reason: unmeasuredAllowed
        ? "intelligence_gate_unmeasured_allowed"
        : "intelligence_gate_sample_insufficient",
      winPct: prior?.pWin === null || prior === null ? null : Number((prior.pWin * 100).toFixed(1)),
      filledN: prior?.filledN ?? null,
      tier: prior?.tier ?? null,
      ...payoffFields,
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
    ...payoffFields,
  };
}
