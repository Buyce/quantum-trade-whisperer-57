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
  p_fill_shrunk: number;
  p_win_shrunk: number;
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

export interface RegimePrior {
  /** P(the limit entry is reached inside the time-in-force window). */
  pFill: number;
  /** P(TP1+ | filled). */
  pWin: number;
  /** Expected-value decomposition: pFill x pWin. */
  ev: number;
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

  const match =
    rows.find((r) => r.tier === 3 && r.regime_key === tier3Key) ??
    rows.find((r) => r.tier === 2 && r.regime_key === tier2Key) ??
    global;

  return summarize(match);
}

function summarize(row: RegimeStatRow): RegimePrior {
  const pFill = clamp01(Number(row.p_fill_shrunk));
  const pWin = clamp01(Number(row.p_win_shrunk));
  const sampleN = Number(row.n_total ?? 0);
  const filledN = Number(row.n_filled ?? 0);
  return {
    pFill: round(pFill),
    pWin: round(pWin),
    ev: round(pFill * pWin),
    sampleN,
    filledN,
    tier: row.tier,
    fillGatePassed: sampleN >= MIN_N_FILL,
    winGatePassed: filledN >= MIN_N_WIN,
  };
}

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

function round(v: number) {
  return Number(v.toFixed(4));
}

/** Human label for the tier that answered, used by the read-only UI panel. */
export function tierLabel(tier: number): string {
  if (tier === 3) return "This exact regime";
  if (tier === 2) return "Instrument + direction";
  return "All instruments";
}
