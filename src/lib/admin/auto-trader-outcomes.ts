/**
 * Broker-verified outcome aggregation for the automatic trader.
 *
 * This is deliberately separate from the shadow-replay grade calibration: that
 * panel answers "what would the replay engine have done", this one answers "what
 * the broker actually did with the orders P-Trades sent". Every input is a closed
 * broker trade — real fill, real exit, broker-reported money.
 *
 * Pure and total: no clock, no Supabase. Rules, in full:
 * - A trade counts toward win rate only when the broker reported money for it
 *   (`netProfit !== null`). A trade with no reported money is counted in `trades`
 *   and in `unmeasured`, never silently as a loss.
 * - `win` is `netProfit > 0`. Exactly zero is a scratch: not a win, not a loss.
 * - Mean R uses `r_vs_plan` where available; a trade whose setup row was purged
 *   has no plan geometry, so it contributes to money and win rate but not to R.
 * - Money is summed per currency. When the rows carry more than one profit
 *   currency the sum is refused (`currency: null`, `mixedCurrency: true`) rather
 *   than adding unlike units together.
 * - Grades are reported as recorded, including grades proved from the decision log
 *   after the setup was purged. A trade with no recoverable grade lands in
 *   "Unknown"; it is never guessed at or dropped.
 */

import {
  compareGradeLadder,
  type GradeObservation,
  type GradePairComparison,
} from "@/lib/admin/grade-comparison";

export type AutoTraderGradeKey = "A+" | "A" | "B" | "C" | "Unknown";

export const AUTO_TRADER_GRADE_ORDER: AutoTraderGradeKey[] = ["A+", "A", "B", "C", "Unknown"];

export interface AutoTraderTrade {
  grade: string | null;
  /** `recovered_from_enqueue_decision` marks a grade proved after the setup was purged. */
  gradeSource: string | null;
  netProfit: number | null;
  rVsPlan: number | null;
  /** Broker symbol, used to keep grade comparison like-for-like. */
  symbol?: string | null;
  /** `long` / `short`, used to keep grade comparison like-for-like. */
  direction?: string | null;
  /** Setup identity: repeated fills of one setup are one cluster, not many. */
  setupKey?: string | null;
  /** `demo` / `live`, reported so demo evidence is never read as a live record. */
  accountType?: string | null;
  /** Entry timestamp (ISO), reported only to label the evidence window. */
  entryAt?: string | null;
}

export interface AutoTraderBucket {
  grade: AutoTraderGradeKey | "TOTAL";
  /** Closed broker trades in this bucket. */
  trades: number;
  /** Trades whose broker money was reported, i.e. the win-rate denominator. */
  measured: number;
  /** Closed trades the broker reported no money for. */
  unmeasured: number;
  wins: number;
  losses: number;
  scratches: number;
  /** `wins / measured`, or null when nothing is measured. */
  winRate: number | null;
  /** Mean `r_vs_plan` over trades that still have plan geometry. */
  meanR: number | null;
  rSample: number;
  /** Distinct setups behind `rSample`; repeated fills of one setup collapse here. */
  rClusters: number;
  /** Sum of broker net profit, in `currency`. Null when currencies are mixed. */
  netProfit: number | null;
  currency: string | null;
  mixedCurrency: boolean;
  /** Trades in this bucket whose grade was recovered from the decision log. */
  recoveredGrades: number;
}

export interface AutoTraderCohortBucket extends AutoTraderBucket {
  symbol: string;
  direction: string;
}

export interface AutoTraderEvidenceScope {
  /** Distinct broker account types behind these trades, e.g. `["demo"]`. */
  accountTypes: string[];
  /** Earliest / latest entry timestamp seen, ISO, or null when unrecorded. */
  from: string | null;
  to: string | null;
  /** Closed trades with money but no risk-normalised outcome. */
  withoutR: number;
  /** Distinct setups behind all measured R values. */
  clusters: number;
}

export interface AutoTraderOutcomes {
  total: AutoTraderBucket;
  byGrade: AutoTraderBucket[];
  /** Grade x instrument x direction, the only level at which money is comparable. */
  byCohort: AutoTraderCohortBucket[];
  /** Adjacent grade-ladder comparisons, stratified and clustered. */
  ladder: GradePairComparison[];
  evidence: AutoTraderEvidenceScope;
}

function normaliseGrade(grade: string | null): AutoTraderGradeKey {
  const g = (grade ?? "").trim();
  return (AUTO_TRADER_GRADE_ORDER as string[]).includes(g) && g !== "Unknown"
    ? (g as AutoTraderGradeKey)
    : "Unknown";
}

/** Setup identity for clustering; a row with no setup key is its own cluster. */
function clusterKeyOf(row: AutoTraderTrade, index: number): string {
  const key = (row.setupKey ?? "").trim();
  return key.length > 0 ? key : `row:${index}`;
}

function summarise(
  grade: AutoTraderGradeKey | "TOTAL",
  rows: (AutoTraderTrade & { currency: string | null })[],
): AutoTraderBucket {
  let measured = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let rSum = 0;
  let rSample = 0;
  let money = 0;
  let recoveredGrades = 0;
  const currencies = new Set<string>();
  const rClusters = new Set<string>();

  rows.forEach((row, index) => {
    if (row.gradeSource === "recovered_from_enqueue_decision") recoveredGrades += 1;
    if (row.netProfit !== null && Number.isFinite(row.netProfit)) {
      measured += 1;
      money += row.netProfit;
      if (row.netProfit > 0) wins += 1;
      else if (row.netProfit < 0) losses += 1;
      else scratches += 1;
      if (row.currency) currencies.add(row.currency);
    }
    if (row.rVsPlan !== null && Number.isFinite(row.rVsPlan)) {
      rSum += row.rVsPlan;
      rSample += 1;
      rClusters.add(clusterKeyOf(row, index));
    }
  });

  const mixedCurrency = currencies.size > 1;
  return {
    grade,
    trades: rows.length,
    measured,
    unmeasured: rows.length - measured,
    wins,
    losses,
    scratches,
    winRate: measured > 0 ? wins / measured : null,
    meanR: rSample > 0 ? rSum / rSample : null,
    rSample,
    rClusters: rClusters.size,
    netProfit: mixedCurrency || measured === 0 ? null : money,
    currency: mixedCurrency ? null : ([...currencies][0] ?? null),
    mixedCurrency,
    recoveredGrades,
  };
}

function stratumOf(row: AutoTraderTrade): { symbol: string; direction: string; label: string } {
  const symbol = (row.symbol ?? "").trim() || "unknown instrument";
  const direction = (row.direction ?? "").trim() || "unknown direction";
  return { symbol, direction, label: `${symbol} ${direction}` };
}

/**
 * Total, per-grade buckets, per-cohort buckets, ladder comparisons and the
 * evidence scope of the whole set.
 *
 * Cohort buckets (grade x instrument x direction) exist because they are the
 * only level at which broker money is comparable: summing money across
 * instruments and lot sizes ranks position size, not setup quality.
 */
export function aggregateAutoTraderOutcomes(
  trades: (AutoTraderTrade & { currency: string | null })[],
): AutoTraderOutcomes {
  const byGrade: AutoTraderBucket[] = [];
  for (const grade of AUTO_TRADER_GRADE_ORDER) {
    const rows = trades.filter((t) => normaliseGrade(t.grade) === grade);
    if (rows.length > 0) byGrade.push(summarise(grade, rows));
  }

  const byCohort: AutoTraderCohortBucket[] = [];
  for (const grade of AUTO_TRADER_GRADE_ORDER) {
    const gradeRows = trades.filter((t) => normaliseGrade(t.grade) === grade);
    const labels = [...new Set(gradeRows.map((t) => stratumOf(t).label))].sort();
    for (const label of labels) {
      const rows = gradeRows.filter((t) => stratumOf(t).label === label);
      const first = stratumOf(rows[0]!);
      byCohort.push({
        ...summarise(grade, rows),
        symbol: first.symbol,
        direction: first.direction,
      });
    }
  }

  const observations: GradeObservation[] = [];
  const clusters = new Set<string>();
  const accountTypes = new Set<string>();
  let withoutR = 0;
  let from: string | null = null;
  let to: string | null = null;

  trades.forEach((row, index) => {
    const type = (row.accountType ?? "").trim();
    if (type) accountTypes.add(type);
    const at = (row.entryAt ?? "").trim();
    if (at) {
      if (from === null || at < from) from = at;
      if (to === null || at > to) to = at;
    }
    const hasR = row.rVsPlan !== null && Number.isFinite(row.rVsPlan);
    if (!hasR) {
      withoutR += 1;
      return;
    }
    const cluster = clusterKeyOf(row, index);
    clusters.add(cluster);
    observations.push({
      grade: normaliseGrade(row.grade),
      stratum: stratumOf(row).label,
      cluster,
      r: row.rVsPlan as number,
    });
  });

  return {
    total: summarise("TOTAL", trades),
    byGrade,
    byCohort,
    ladder: compareGradeLadder(observations),
    evidence: {
      accountTypes: [...accountTypes].sort(),
      from,
      to,
      withoutR,
      clusters: clusters.size,
    },
  };
}
