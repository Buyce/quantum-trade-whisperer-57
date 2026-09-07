/**
 * Platform-wide trade totals.
 *
 * Two independent ledgers, never merged:
 * - Broker-verified: closed customer broker-trade evidence. Win/loss/breakeven is
 *   decided by broker net money (gross + swap + commission). Exactly zero is a
 *   breakeven, never a loss. A row the broker reported no money for is counted in
 *   `closed` and in `unmeasured`, never guessed at.
 * - Journal: the in-app `executed_trades` record, which lags while trades are open.
 *
 * Money is summed per currency. When the rows carry more than one profit currency
 * the sum is refused (`grossProfit: null`, `mixedCurrency: true`) rather than adding
 * unlike units together.
 *
 * Pure and total: no clock, no Supabase.
 */

/**
 * Who placed the trade, decided from the evidence row itself:
 * - `auto`: still linked to an automatic dispatch record.
 * - `unlinked`: carries the platform's own order tag but the dispatch link is gone
 *   (its setup row was purged), so the run cannot be named.
 * - `external`: no platform tag at all — placed outside P-Trades.
 */
export type BrokerAttribution = "auto" | "unlinked" | "external";

export interface BrokerEvidenceRow {
  accountId: string | null;
  grossProfit: number | null;
  swap: number | null;
  commission: number | null;
  currency: string | null;
  attribution: BrokerAttribution;
  /**
   * Which target rank the submitted exit sat at (1, 2 or 3), copied from the
   * dispatch record at observation time. NULL on rows dispatched before the rule
   * was recorded — those are reported as not recorded, never assumed first-target.
   */
  targetRank?: 1 | 2 | 3 | null;
  /** True when the position was managed after the fill (partial close + stop move). */
  managedExit?: boolean | null;
}

export interface BrokerTotals {
  wins: number;
  losses: number;
  breakeven: number;
  /** All closed rows, including rows with no broker-reported money. */
  closed: number;
  /** Closed rows the broker reported no money for. */
  unmeasured: number;
  /** Distinct accounts that contributed at least one closed row. */
  accounts: number;
  /** Sum of broker gross profit, in `currency`. Null when currencies are mixed. */
  grossProfit: number | null;
  /** Sum of broker net money (gross + swap + commission). Null when mixed. */
  netProfit: number | null;
  currency: string | null;
  mixedCurrency: boolean;
}

export interface JournalTotals {
  wins: number;
  losses: number;
  breakeven: number;
  open: number;
  /** Rows whose outcome is none of the above. */
  other: number;
  rows: number;
}

export interface BrokerTotalsByAttribution {
  auto: BrokerTotals;
  unlinked: BrokerTotals;
  external: BrokerTotals;
  /** Every closed row, whatever placed it. */
  all: BrokerTotals;
}

/**
 * Automatic broker trades split by which published target their exit sat at, so a
 * deeper-target trade is never scored against first-target history. `notRecorded`
 * holds the rows dispatched before the rule was recorded.
 */
export interface BrokerTotalsByTarget {
  firstTarget: BrokerTotals;
  secondTarget: BrokerTotals;
  thirdTarget: BrokerTotals;
  managed: BrokerTotals;
  notRecorded: BrokerTotals;
}

export interface TradeTotals {
  broker: BrokerTotalsByAttribution;
  byTarget: BrokerTotalsByTarget;
  journal: JournalTotals;
}

const finite = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function aggregateBrokerTotals(rows: BrokerEvidenceRow[]): BrokerTotals {
  const accounts = new Set<string>();
  const currencies = new Set<string>();
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let unmeasured = 0;
  let gross = 0;
  let net = 0;

  for (const row of rows) {
    if (row.accountId) accounts.add(row.accountId);
    if (row.currency) currencies.add(row.currency);

    const g = finite(row.grossProfit);
    if (g === null) {
      unmeasured += 1;
      continue;
    }
    const n = g + (finite(row.swap) ?? 0) + (finite(row.commission) ?? 0);
    gross += g;
    net += n;
    if (n > 0) wins += 1;
    else if (n < 0) losses += 1;
    else breakeven += 1;
  }

  const mixedCurrency = currencies.size > 1;
  return {
    wins,
    losses,
    breakeven,
    closed: rows.length,
    unmeasured,
    accounts: accounts.size,
    grossProfit: mixedCurrency ? null : gross,
    netProfit: mixedCurrency ? null : net,
    currency: mixedCurrency ? null : (currencies.values().next().value ?? null),
    mixedCurrency,
  };
}

/**
 * Same classification, split by who placed the trade. Each bucket is an ordinary
 * `BrokerTotals`, so mixed-currency refusal applies per bucket and to the combined
 * total independently.
 */
export function aggregateBrokerTotalsByAttribution(
  rows: BrokerEvidenceRow[],
): BrokerTotalsByAttribution {
  const of = (a: BrokerAttribution) =>
    aggregateBrokerTotals(rows.filter((r) => r.attribution === a));
  return {
    auto: of("auto"),
    unlinked: of("unlinked"),
    external: of("external"),
    all: aggregateBrokerTotals(rows),
  };
}

export function aggregateBrokerTotalsByTarget(rows: BrokerEvidenceRow[]): BrokerTotalsByTarget {
  // Only automatic dispatches can carry an exit rule; an externally placed trade
  // has none by definition, so it is not counted in any target bucket.
  const auto = rows.filter((r) => r.attribution === "auto");
  const rank = (n: 1 | 2 | 3) =>
    aggregateBrokerTotals(auto.filter((r) => r.targetRank === n && r.managedExit !== true));
  return {
    firstTarget: rank(1),
    secondTarget: rank(2),
    thirdTarget: rank(3),
    managed: aggregateBrokerTotals(auto.filter((r) => r.managedExit === true)),
    notRecorded: aggregateBrokerTotals(
      auto.filter((r) => r.targetRank !== 1 && r.targetRank !== 2 && r.targetRank !== 3),
    ),
  };
}

export function aggregateJournalTotals(outcomes: (string | null)[]): JournalTotals {
  const totals: JournalTotals = {
    wins: 0,
    losses: 0,
    breakeven: 0,
    open: 0,
    other: 0,
    rows: outcomes.length,
  };
  for (const outcome of outcomes) {
    if (outcome === "win") totals.wins += 1;
    else if (outcome === "loss") totals.losses += 1;
    else if (outcome === "breakeven") totals.breakeven += 1;
    else if (outcome === "open") totals.open += 1;
    else totals.other += 1;
  }
  return totals;
}
