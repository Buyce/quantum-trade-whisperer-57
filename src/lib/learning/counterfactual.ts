/**
 * Counterfactual stop harness (research only — pure module, no I/O).
 *
 * Answers one question honestly: what would already-resolved replay setups have
 * returned under a DIFFERENT stop rule? Nothing here touches the live scanner,
 * the published feed, sizing, or any user-facing surface.
 *
 * Zero-hallucination rules enforced here:
 *  - Every input number comes from a resolved `shadow_executions` row produced
 *    by Replay V2 on real candles. Nothing is invented or interpolated.
 *  - A row whose counterfactual outcome cannot be PROVEN from the stored path
 *    summary is labelled `ambiguous` and reported with explicit worst/best
 *    bounds. It is never silently resolved in the favourable direction.
 *  - A rule that the stored summary cannot decide at all returns
 *    `not_decidable` with the missing measurement named, rather than a number.
 *
 * Why the path summary is enough for a TIGHTER stop, and only that:
 *  MFE/MAE are measured in R against the ORIGINAL risk and accumulate only over
 *  post-fill bars up to and including the resolving bar. So:
 *   - a loser already reached >= 1R adverse, therefore any tighter stop was also
 *     reached: still a loss (deterministic);
 *   - a winner whose whole adverse path stayed inside the tighter stop still
 *     wins (deterministic), and pays MORE because the risk denominator shrank;
 *   - a winner whose adverse path reached the tighter stop is AMBIGUOUS: M15
 *     OHLC cannot order that drawdown against the target touch on the resolving
 *     bar. Same conservative-fallback principle as Replay V2 itself.
 *  A break-even/trailing rule needs the ORDER of post-entry events, which a
 *  two-number path summary does not carry — hence `not_decidable`.
 */
import { bootstrapMeanR, type BootstrapResult, type RObservation } from "@/lib/stats/bootstrap";

export const COUNTERFACTUAL_VERSION = 1;

/** Replay outcomes this harness is able to reason about. */
const CONSIDERED = new Set(["win", "loss", "expired", "never_filled"]);

export interface CounterfactualInput {
  /** Stable tie-break identity (the `shadow_executions` row id). */
  id: string;
  /** UTC `detected_at` — the bootstrap clustering unit. */
  detectedAt: string;
  outcome: string | null;
  /** Realized R under the live rule, against actual risk. */
  grossR: number | null;
  /** Max adverse excursion in R against original risk (>= 0). */
  maeR: number | null;
  /** Max favorable excursion in R against original risk (>= 0). */
  mfeR: number | null;
}

export type RowVerdict = "deterministic" | "ambiguous" | "excluded";

export interface RowCounterfactual {
  id: string;
  detectedAt: string;
  verdict: RowVerdict;
  /** Baseline R under the live rule; null when excluded. */
  baseR: number | null;
  /** Worst admissible counterfactual R; null when excluded. */
  worstR: number | null;
  /** Best admissible counterfactual R; null when excluded. */
  bestR: number | null;
  /** Why a row was excluded or could not be proven. Null when deterministic. */
  reason: string | null;
}

export interface CounterfactualArm {
  n: number;
  meanR: number | null;
  wins: number;
  losses: number;
  bootstrap: BootstrapResult;
}

export interface CounterfactualReport {
  version: number;
  rule: string;
  /** Stop tightening factor: new risk = factor x original risk. */
  factor: number;
  considered: number;
  deterministic: number;
  ambiguous: number;
  excluded: number;
  /** Live rule, over exactly the same considered rows. */
  baseline: CounterfactualArm;
  /** Ambiguous rows resolved AGAINST us. The figure we are allowed to act on. */
  conservative: CounterfactualArm;
  /** Ambiguous rows resolved in our favour. An upper bound, never a claim. */
  optimistic: CounterfactualArm;
  /** Deterministic rows only — no ambiguity, but a filtered subset. */
  provenOnly: CounterfactualArm;
  rows: RowCounterfactual[];
}

export interface NotDecidable {
  version: number;
  rule: string;
  decidable: false;
  /** The measurement that would be required, named exactly. */
  missing: string;
}

/**
 * A tighter initial stop at `factor` x the original risk distance.
 *
 * `factor` must lie in (0, 1): 1 is the live rule and above 1 is a WIDER stop,
 * whose winners cannot be adjudicated from this summary (a wider stop can turn
 * a stopped-out loser into a later win, which the summary cannot prove).
 */
export function evaluateTighterStop(
  rows: readonly CounterfactualInput[],
  factor: number,
): CounterfactualReport | NotDecidable {
  const rule = `tighter_initial_stop@${factor}`;
  if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) {
    return {
      version: COUNTERFACTUAL_VERSION,
      rule,
      decidable: false,
      missing:
        "a tightening factor strictly between 0 and 1; a wider stop cannot be adjudicated from a path summary because it may convert a loss into a later win",
    };
  }

  const evaluated = rows.map((row) => evaluateRow(row, factor));

  const usable = evaluated.filter((r) => r.verdict !== "excluded");
  const proven = evaluated.filter((r) => r.verdict === "deterministic");

  return {
    version: COUNTERFACTUAL_VERSION,
    rule,
    factor,
    considered: usable.length,
    deterministic: proven.length,
    ambiguous: evaluated.filter((r) => r.verdict === "ambiguous").length,
    excluded: evaluated.filter((r) => r.verdict === "excluded").length,
    baseline: arm(usable.map((r) => ({ ...r, pick: r.baseR }))),
    conservative: arm(usable.map((r) => ({ ...r, pick: r.worstR }))),
    optimistic: arm(usable.map((r) => ({ ...r, pick: r.bestR }))),
    provenOnly: arm(proven.map((r) => ({ ...r, pick: r.worstR }))),
    rows: evaluated,
  };
}

/**
 * Move the stop to break-even once price reaches `triggerR`.
 *
 * Deliberately undecidable from stored data: whether a winner retraced to entry
 * AFTER reaching the trigger, and whether a loser reached the trigger BEFORE
 * turning, are both ordering facts that MFE/MAE do not carry.
 */
export function evaluateBreakevenStop(triggerR: number): NotDecidable {
  return {
    version: COUNTERFACTUAL_VERSION,
    rule: `breakeven_stop@${triggerR}R`,
    decidable: false,
    missing:
      "bar-level post-entry price path. The stored summary carries only max favorable and max adverse excursion, which cannot order a retrace to entry against the excursion that triggered the move.",
  };
}

function evaluateRow(row: CounterfactualInput, factor: number): RowCounterfactual {
  const base = { id: row.id, detectedAt: row.detectedAt };
  const excluded = (reason: string): RowCounterfactual => ({
    ...base,
    verdict: "excluded",
    baseR: null,
    worstR: null,
    bestR: null,
    reason,
  });

  if (row.outcome == null || !CONSIDERED.has(row.outcome)) {
    return excluded(`outcome "${row.outcome ?? "unresolved"}" is not adjudicable`);
  }

  // A setup that never filled is untouched by the stop distance.
  if (row.outcome === "never_filled") {
    return { ...base, verdict: "deterministic", baseR: 0, worstR: 0, bestR: 0, reason: null };
  }

  if (row.grossR == null || !Number.isFinite(row.grossR)) {
    return excluded("no realized R recorded");
  }
  if (row.maeR == null || !Number.isFinite(row.maeR)) {
    return excluded("no max adverse excursion recorded");
  }

  // A loser already travelled at least the full original risk against us, so any
  // tighter stop was reached too. Loss stands, at -1R on the new risk basis.
  if (row.outcome === "loss") {
    return { ...base, verdict: "deterministic", baseR: row.grossR, worstR: -1, bestR: -1, reason: null };
  }

  // Winners and expiries: the R denominator shrinks by `factor`.
  const scaled = row.grossR / factor;

  if (row.maeR < factor) {
    // The entire adverse path stayed inside the tighter stop.
    return { ...base, verdict: "deterministic", baseR: row.grossR, worstR: scaled, bestR: scaled, reason: null };
  }

  return {
    ...base,
    verdict: "ambiguous",
    baseR: row.grossR,
    worstR: -1,
    bestR: scaled,
    reason: `adverse excursion ${row.maeR.toFixed(3)}R reached the tighter stop at ${factor}R; M15 OHLC cannot order it against the resolving bar`,
  };
}

function arm(rows: Array<RowCounterfactual & { pick: number | null }>): CounterfactualArm {
  const observations: RObservation[] = [];
  let wins = 0;
  let losses = 0;
  for (const row of rows) {
    if (row.pick == null) continue;
    observations.push({ id: row.id, detectedAt: row.detectedAt, r: row.pick });
    if (row.pick > 0) wins += 1;
    else if (row.pick < 0) losses += 1;
  }
  const bootstrap = bootstrapMeanR(observations);
  return {
    n: observations.length,
    meanR: bootstrap.mean,
    wins,
    losses,
    bootstrap,
  };
}

/**
 * Whether a tightening factor is supported: the conservative arm must beat the
 * baseline AND its 95% cluster-bootstrap interval must clear zero. Ambiguity is
 * always paid for by the proposal, never by the baseline.
 */
export function isSupported(report: CounterfactualReport): boolean {
  const c = report.conservative;
  const b = report.baseline;
  if (c.bootstrap.status !== "ok" || b.bootstrap.status !== "ok") return false;
  if (c.meanR == null || b.meanR == null) return false;
  if (c.meanR <= b.meanR) return false;
  return (c.bootstrap.ciLo ?? -Infinity) > 0;
}
