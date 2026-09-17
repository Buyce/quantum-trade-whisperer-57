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

/**
 * What the users' OWN journal says, on top of the raw outcome counts.
 *
 * The journal carries no broker money: an in-app row records an R multiple the
 * person entered themselves, so growth here is expressed in R and is never
 * presented as an account balance. Rows that carry no R value are counted in
 * `missingR` and left out of the sum rather than treated as 0R, so the total can
 * never look more complete than the record actually is.
 */
export interface JournalPerformance {
  /** Rows with a decided outcome: win, loss or breakeven. */
  resolved: number;
  /** Wins / resolved, as a percentage. Null when nothing is resolved yet. */
  winRatePercent: number | null;
  /** Sum of the self-reported R multiples that exist. Null when none do. */
  totalR: number | null;
  /** Mean R across the rows that carry one. Null when none do. */
  meanR: number | null;
  /** Resolved rows that carry an R value. */
  rSamples: number;
  /** Resolved rows with no R value, so absent from `totalR`. */
  missingR: number;
  /** ISO timestamp of the first journal row, i.e. when logging began. */
  firstLoggedAt: string | null;
  /** ISO timestamp of the most recent journal row. */
  lastLoggedAt: string | null;
}

export interface JournalRow {
  outcome: string | null;
  /** Self-reported R multiple, when the person recorded one. */
  r: number | null;
  createdAt: string | null;
}

export interface TradeTotals {
  broker: BrokerTotalsByAttribution;
  byTarget: BrokerTotalsByTarget;
  journal: JournalTotals;
  journalPerformance: JournalPerformance;
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

/**
 * Self-reported win rate and R growth since the person's first journal entry.
 *
 * Self-reported throughout: these are the numbers users typed, not the broker's.
 * They are reported next to the broker ledger for comparison and are never merged
 * with it.
 */
export function aggregateJournalPerformance(rows: JournalRow[]): JournalPerformance {
  let resolved = 0;
  let wins = 0;
  let rSamples = 0;
  let missingR = 0;
  let sumR = 0;
  let first: number | null = null;
  let last: number | null = null;
  let firstIso: string | null = null;
  let lastIso: string | null = null;

  for (const row of rows) {
    if (row.createdAt) {
      const t = new Date(row.createdAt).getTime();
      if (Number.isFinite(t)) {
        if (first === null || t < first) {
          first = t;
          firstIso = row.createdAt;
        }
        if (last === null || t > last) {
          last = t;
          lastIso = row.createdAt;
        }
      }
    }
    const decided = row.outcome === "win" || row.outcome === "loss" || row.outcome === "breakeven";
    if (!decided) continue;
    resolved += 1;
    if (row.outcome === "win") wins += 1;
    const r = finite(row.r);
    if (r === null) missingR += 1;
    else {
      rSamples += 1;
      sumR += r;
    }
  }

  return {
    resolved,
    winRatePercent: resolved > 0 ? (wins / resolved) * 100 : null,
    totalR: rSamples > 0 ? sumR : null,
    meanR: rSamples > 0 ? sumR / rSamples : null,
    rSamples,
    missingR,
    firstLoggedAt: firstIso,
    lastLoggedAt: lastIso,
  };
}
