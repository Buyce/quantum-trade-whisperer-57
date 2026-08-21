/**
 * Hierarchical Beta-Binomial regime lookup — pure, browser-safe maths.
 *
 * `regime_stats` is rebuilt in one transaction by the shadow-resolve cron. Every
 * tier is already shrunk toward its parent in SQL (prior strength k = 30), so
 * this module only has to pick the most specific tier that exists and report the
 * sample size behind it honestly.
 *
 * ACTIVATION GATES: the returned probabilities are ADVISORY ONLY until the
 * sample thresholds below are met. Nothing in the live pipeline may branch on
 * them — grading, alert fan-out and the daily cap are untouched by design.
 */

/** Resolved shadow samples required before P(fill) may influence entry guidance. */
export const MIN_N_FILL = 150;
/** Filled shadow samples required before P(win | filled) may influence grading. */
export const MIN_N_WIN = 200;
/**
 * Resolved samples a tier-3 (exact regime) bucket must hold before it is allowed
 * to answer a lookup. Below the floor the bucket is skipped and the lookup falls
 * back to instrument+direction, then global — a thin bucket must never be
 * presented as a specific read.
 */
export const MIN_N_TIER3 = 20;

export type VolBucket = "low" | "mid" | "high" | "unknown";

export interface RegimeStatRow {
  tier: number;
  regime_key: string;
  instrument: string | null;
  direction: string | null;
  session: string | null;
  vol_bucket: string | null;
  n_total: number;
  n_filled: number;
  wins: number;
  /**
   * NULL when the denominator behind the estimate is empty. The rebuild never
   * fabricates a 0.5 prior, so every consumer must handle null explicitly.
   */
  p_fill_shrunk: number | null;
  p_win_shrunk: number | null;
  /** Unsmoothed rates; only selected by the explain panel, absent elsewhere. */
  p_fill_raw?: number | null;
  p_win_raw?: number | null;
  vol_t1: number | null;
  vol_t2: number | null;
}

export interface RegimeQuery {
  instrument: string;
  direction: string;
  session: string;
  volatilityIndex: number | null;
}

/**
 * How much of the prior is statistically defined.
 * - `active`: both probabilities exist and both sample gates are clear.
 * - `learning`: probabilities exist but at least one gate is still open.
 * - `unavailable`: at least one probability has no data behind it (null).
 */
export type RegimePriorStatus = "active" | "learning" | "unavailable";

export interface RegimePrior {
  /** P(the limit entry is reached inside the time-in-force window), null when undefined. */
  pFill: number | null;
  /** P(TP1+ | filled), null when no filled samples exist. */
  pWin: number | null;
  /**
   * Joint win probability: pFill x pWin. A PROBABILITY, not an expected return
   * and not an expected R. Null whenever either factor is null.
   */
  pJoint: number | null;
  /** Resolved samples behind pFill at the matched tier. */
  sampleN: number;
  /** Filled samples behind pWin at the matched tier. */
  filledN: number;
  /** Which tier actually answered: 3 = exact regime, 2 = instrument, 1 = global. */
  tier: number;
  /** True once the tier clears MIN_N_FILL — until then pFill is advisory. */
  fillGatePassed: boolean;
  /** True once the tier clears MIN_N_WIN — until then pWin is advisory. */
  winGatePassed: boolean;
  /**
   * Set when an exact-regime bucket existed but held fewer than MIN_N_TIER3
   * resolved samples, so the lookup fell back to a parent tier. Reported to the
   * user verbatim; never hidden.
   */
  tier3SkippedN: number | null;
  /** Coarse readiness of this prior. */
  status: RegimePriorStatus;
  /** Machine-readable explanation of `status`; safe to surface verbatim. */
  reason: string;
}

/**
 * Classify a live setup into the same tercile the statistics were built from.
 * Boundaries come from the tier-0 rows so the scanner never invents its own.
 */
export function volBucketOf(volatilityIndex: number | null, t1: number | null, t2: number | null): VolBucket {
  if (volatilityIndex == null || t1 == null || t2 == null) return "unknown";
  if (volatilityIndex <= t1) return "low";
  if (volatilityIndex <= t2) return "mid";
  return "high";
}

/** Most specific tier first, falling back to the parent — never to a made-up number. */
export function lookupRegime(rows: RegimeStatRow[], query: RegimeQuery): RegimePrior | null {
  const global = rows.find((r) => r.tier === 1);
  if (!global) return null;

  const boundaries = rows.find((r) => r.tier === 0 && r.instrument === query.instrument);
  const bucket = volBucketOf(
    query.volatilityIndex,
    boundaries?.vol_t1 ?? null,
    boundaries?.vol_t2 ?? null,
  );

  const tier3Key = `${query.instrument}|${query.direction}|${query.session}|${bucket}`;
  const tier2Key = `${query.instrument}|${query.direction}`;

  const tier3 = rows.find((r) => r.tier === 3 && r.regime_key === tier3Key);
  const tier3Eligible = tier3 && Number(tier3.n_total ?? 0) >= MIN_N_TIER3 ? tier3 : undefined;
  const tier3SkippedN =
    tier3 && !tier3Eligible ? Number(tier3.n_total ?? 0) : null;

  const match =
    tier3Eligible ??
    rows.find((r) => r.tier === 2 && r.regime_key === tier2Key) ??
    global;

  return summarize(match, tier3SkippedN);
}

function summarize(row: RegimeStatRow, tier3SkippedN: number | null): RegimePrior {
  const pFill = finiteOrNull(row.p_fill_shrunk);
  const pWin = finiteOrNull(row.p_win_shrunk);
  const sampleN = Number(row.n_total ?? 0);
  const filledN = Number(row.n_filled ?? 0);
  const fillGatePassed = sampleN >= MIN_N_FILL;
  const winGatePassed = filledN >= MIN_N_WIN;

  let status: RegimePriorStatus;
  let reason: string;
  if (pFill == null || pWin == null) {
    status = "unavailable";
    reason = pFill == null ? "no_resolved_samples" : "no_filled_samples";
  } else if (fillGatePassed && winGatePassed) {
    status = "active";
    reason = "both_gates_passed";
  } else {
    status = "learning";
    reason = !fillGatePassed ? "fill_gate_open" : "win_gate_open";
  }

  return {
    pFill: round(pFill),
    pWin: round(pWin),
    pJoint: pFill == null || pWin == null ? null : round(pFill * pWin),
    sampleN,
    filledN,
    tier: row.tier,
    fillGatePassed,
    winGatePassed,
    tier3SkippedN,
    status,
    reason,
  };
}

/**
 * A statistic with an empty denominator has no value. Null in, null out — the
 * one thing that must never happen is a fabricated midpoint.
 */
export function finiteOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

function round(v: number | null) {
  if (v == null) return null;
  return Number(v.toFixed(4));
}


/** Human label for the tier that answered, used by the read-only UI panel. */
export function tierLabel(tier: number): string {
  if (tier === 3) return "This exact regime";
  if (tier === 2) return "Instrument + direction";
  return "All instruments";
}
