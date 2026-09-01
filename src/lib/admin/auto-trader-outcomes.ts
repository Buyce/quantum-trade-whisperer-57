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

export type AutoTraderGradeKey = "A+" | "A" | "B" | "C" | "Unknown";

export const AUTO_TRADER_GRADE_ORDER: AutoTraderGradeKey[] = ["A+", "A", "B", "C", "Unknown"];

export interface AutoTraderTrade {
  grade: string | null;
  /** `recovered_from_enqueue_decision` marks a grade proved after the setup was purged. */
  gradeSource: string | null;
  netProfit: number | null;
  rVsPlan: number | null;
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
  /** Sum of broker net profit, in `currency`. Null when currencies are mixed. */
  netProfit: number | null;
  currency: string | null;
  mixedCurrency: boolean;
  /** Trades in this bucket whose grade was recovered from the decision log. */
  recoveredGrades: number;
}

export interface AutoTraderOutcomes {
  total: AutoTraderBucket;
  byGrade: AutoTraderBucket[];
}

function normaliseGrade(grade: string | null): AutoTraderGradeKey {
  const g = (grade ?? "").trim();
  return (AUTO_TRADER_GRADE_ORDER as string[]).includes(g) && g !== "Unknown"
    ? (g as AutoTraderGradeKey)
    : "Unknown";
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

  for (const row of rows) {
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
    }
  }

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
    netProfit: mixedCurrency || measured === 0 ? null : money,
    currency: mixedCurrency ? null : ([...currencies][0] ?? null),
    mixedCurrency,
    recoveredGrades,
  };
}

/** Total plus one bucket per grade actually present, in grade order. */
export function aggregateAutoTraderOutcomes(
  trades: (AutoTraderTrade & { currency: string | null })[],
): AutoTraderOutcomes {
  const byGrade: AutoTraderBucket[] = [];
  for (const grade of AUTO_TRADER_GRADE_ORDER) {
    const rows = trades.filter((t) => normaliseGrade(t.grade) === grade);
    if (rows.length > 0) byGrade.push(summarise(grade, rows));
  }
  return { total: summarise("TOTAL", trades), byGrade };
}
