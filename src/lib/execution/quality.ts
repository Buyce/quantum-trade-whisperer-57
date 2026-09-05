/**
 * Execution-quality scoring — the pure mathematics.
 *
 * Everything here is computed from recorded facts only: closed broker trades
 * (slippage the broker actually gave, realised R) and the delivery ledger
 * (what was rejected, how often, and why). A dimension without enough recorded
 * fact is "not measured" — it never earns a score and never triggers a
 * cooldown. Nothing is estimated, extrapolated or defaulted to zero.
 *
 * A cooldown compares a dimension's RECENT window against its own EARLIER norm
 * — never against another instrument, account or a hardcoded constant — so a
 * naturally wide-spread instrument is judged against its own history, not
 * against EURUSD's.
 */

export const RECENT_WINDOW_DAYS = 14;
export const NORM_WINDOW_DAYS = 60;
/** Below this many recent closed trades the recent window says nothing. */
export const MIN_RECENT_CLOSED = 5;
/** Below this many norm closed trades there is no norm to breach. */
export const MIN_NORM_CLOSED = 10;
/** Below this many recent deliveries the reject rate says nothing. */
export const MIN_RECENT_DELIVERIES = 10;
/** Recent median slippage must exceed norm by BOTH factors to breach. */
export const SLIPPAGE_BREACH_MULTIPLE = 2;
/** Recent reject rate must exceed the norm by at least this absolute margin. */
export const REJECT_RATE_BREACH_MARGIN = 0.15;
/** How long a breached dimension is paused before it is re-tested live. */
export const COOLDOWN_HOURS = 24;

export type CooldownReason = "slippage_breach" | "reject_rate_breach";

export interface ClosedExecution {
  exitAtMs: number;
  /** Signed slippage in price units; positive = broker filled worse. */
  slippagePrice: number | null;
  rVsPlan: number | null;
}

export interface DeliveryOutcome {
  enqueuedAtMs: number;
  state: string;
  rejectReason: string | null;
}

export interface DimensionEvidence {
  closed: ClosedExecution[];
  deliveries: DeliveryOutcome[];
}

export interface DimensionScore {
  recentWindowDays: number;
  closedSample: number;
  slippageSample: number;
  medianSlippage: number | null;
  p90Slippage: number | null;
  rSample: number;
  avgR: number | null;
  deliverySample: number;
  rejectedCount: number;
  rejectRate: number | null;
  marginRefusals: number;
  measured: boolean;
  unmeasuredReason: string | null;
}

export interface CooldownVerdict {
  breached: boolean;
  reason: CooldownReason | null;
  detail: string | null;
  observed: number | null;
  norm: number | null;
  resumeAfterMs: number | null;
}

function finite(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = sorted(values);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Nearest-rank 90th percentile: a tail figure, never an average. */
export function p90(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = sorted(values);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)] as number;
}

/** Rejection reasons that mean the broker refused for lack of margin. */
const MARGIN_REASONS = new Set(["no_money", "not_enough_money", "margin"]);

function isMarginRefusal(reason: string | null): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  for (const m of MARGIN_REASONS) if (r.includes(m)) return true;
  return false;
}

function isRejected(state: string): boolean {
  return state === "rejected" || state === "refused" || state === "failed";
}

/**
 * Score one window of evidence for one (account, instrument, session)
 * dimension. Windows with too little recorded fact come back unmeasured with
 * the reason spelled out.
 */
export function scoreWindow(evidence: DimensionEvidence, windowDays: number): DimensionScore {
  const closed = evidence.closed;
  const slippages = closed
    .map((c) => finite(c.slippagePrice))
    .filter((v): v is number => v !== null);
  const rs = closed.map((c) => finite(c.rVsPlan)).filter((v): v is number => v !== null);

  const rejected = evidence.deliveries.filter((d) => isRejected(d.state));
  const deliverySample = evidence.deliveries.length;

  const measured = closed.length >= MIN_RECENT_CLOSED;
  return {
    recentWindowDays: windowDays,
    closedSample: closed.length,
    slippageSample: slippages.length,
    medianSlippage: median(slippages),
    p90Slippage: p90(slippages),
    rSample: rs.length,
    avgR: rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    deliverySample,
    rejectedCount: rejected.length,
    rejectRate: deliverySample > 0 ? rejected.length / deliverySample : null,
    marginRefusals: rejected.filter((d) => isMarginRefusal(d.rejectReason)).length,
    measured,
    unmeasuredReason: measured
      ? null
      : `only ${closed.length} closed broker trades in the window (need ${MIN_RECENT_CLOSED})`,
  };
}

/**
 * Decide whether the recent window is materially worse than the dimension's
 * own norm. Either side unmeasured ⇒ no breach: an unmeasured norm cannot be
 * breached and an unmeasured recent window proves nothing.
 */
export function evaluateCooldown(
  recent: DimensionScore,
  norm: DimensionScore,
  nowMs: number,
): CooldownVerdict {
  const clear: CooldownVerdict = {
    breached: false,
    reason: null,
    detail: null,
    observed: null,
    norm: null,
    resumeAfterMs: null,
  };
  if (!recent.measured) return clear;

  const resumeAfterMs = nowMs + COOLDOWN_HOURS * 60 * 60 * 1000;

  if (
    norm.closedSample >= MIN_NORM_CLOSED &&
    recent.medianSlippage !== null &&
    norm.medianSlippage !== null &&
    norm.medianSlippage > 0 &&
    recent.medianSlippage > norm.medianSlippage * SLIPPAGE_BREACH_MULTIPLE
  ) {
    return {
      breached: true,
      reason: "slippage_breach",
      detail:
        `recent median slippage on this account/instrument/session is ` +
        `${recent.medianSlippage} vs its own norm of ${norm.medianSlippage} ` +
        `(more than ${SLIPPAGE_BREACH_MULTIPLE}x worse over the last ${recent.recentWindowDays} days)`,
      observed: recent.medianSlippage,
      norm: norm.medianSlippage,
      resumeAfterMs,
    };
  }

  if (
    recent.deliverySample >= MIN_RECENT_DELIVERIES &&
    recent.rejectRate !== null &&
    norm.rejectRate !== null &&
    recent.rejectRate > norm.rejectRate + REJECT_RATE_BREACH_MARGIN
  ) {
    return {
      breached: true,
      reason: "reject_rate_breach",
      detail:
        `recent broker reject rate on this account/instrument/session is ` +
        `${(recent.rejectRate * 100).toFixed(1)}% vs its own norm of ` +
        `${(norm.rejectRate * 100).toFixed(1)}%`,
      observed: recent.rejectRate,
      norm: norm.rejectRate,
      resumeAfterMs,
    };
  }

  return clear;
}

/** Split evidence rows into the recent window and the earlier norm window. */
export function splitWindows<T extends { atMs: number }>(
  rows: readonly T[],
  nowMs: number,
): { recent: T[]; norm: T[] } {
  const recentCut = nowMs - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const normCut = nowMs - NORM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent: T[] = [];
  const norm: T[] = [];
  for (const row of rows) {
    if (row.atMs >= recentCut) recent.push(row);
    else if (row.atMs >= normCut) norm.push(row);
  }
  return { recent, norm };
}
