/**
 * Advisory portfolio exposure, derived ONLY from the trades the user logged.
 *
 * P-Trades has no read access to a user's broker account, so nothing here can
 * claim to describe real account exposure. Every figure is labelled "based on
 * trades you logged", is advisory, and never blocks sizing or execution.
 */
import { CONTRACT_SPECS, type RiskProfile } from "@/lib/risk";

export interface AdvisoryTradeRow {
  outcome: string | null;
  trade_state?: string | null;
  actual_entry_at?: string | null;
  actual_exit_at?: string | null;
  updated_at?: string | null;
  signal_instrument?: string | null;
  /** Canonical planned-risk R. The ONLY R this advisory may aggregate. */
  r_vs_plan?: number | string | null;
}

export interface CurrencyExposure {
  currency: string;
  /** Number of logged open positions whose base currency is this one. */
  positions: number;
  /** Advisory risk in R units (one logged open trade = one risk unit). */
  riskR: number;
  /** Share of total logged open risk, 0-1. */
  share: number;
}

export interface PortfolioAdvisory {
  basis: "trades you logged";
  /** Logged trades that are open and have a recorded entry. */
  openPositions: number;
  /** Logged trades that are open with no recorded entry yet (pending fills). */
  pendingPositions: number;
  /** Advisory initial risk of open positions, in R units. */
  openRiskR: number;
  pendingRiskR: number;
  /** Same figures converted with the user's current risk budget, when set. */
  openRiskMoney: number | null;
  pendingRiskMoney: number | null;
  /** Sum of negative resolved R closed today (UTC), as a positive number. */
  realizedLossTodayR: number;
  realizedLossTodayMoney: number | null;
  byCurrency: CurrencyExposure[];
  currency: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function utcDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Pure aggregation. `riskBudget` is the money value of 1R from the user's own
 * profile; when equity is unset the money columns are null rather than zero.
 */
export function portfolioAdvisory(
  trades: readonly AdvisoryTradeRow[],
  profile: RiskProfile,
  now = new Date(),
): PortfolioAdvisory {
  const riskBudget =
    profile.accountEquity > 0 ? profile.accountEquity * (profile.riskPerTradePercent / 100) : null;
  const today = now.toISOString().slice(0, 10);

  let openPositions = 0;
  let pendingPositions = 0;
  let realizedLossTodayR = 0;
  const byCurrency = new Map<string, number>();

  for (const t of trades) {
    const open = t.outcome === "open";
    if (open) {
      const filled = Boolean(t.actual_entry_at);
      if (filled) {
        openPositions += 1;
        const base = CONTRACT_SPECS[t.signal_instrument ?? ""]?.base ?? "unknown";
        byCurrency.set(base, (byCurrency.get(base) ?? 0) + 1);
      } else {
        pendingPositions += 1;
      }
      continue;
    }
    // Resolved: count only losses closed today, and only from a canonical R.
    const closedDay = utcDay(t.actual_exit_at ?? t.updated_at ?? null);
    if (closedDay !== today) continue;
    // Prompt-9 basis isolation: canonical r_vs_plan only. Frozen legacy R
    // (derived_r / realized_r_multiple) is a different unit of account and is
    // excluded rather than converted.
    const r = num(t.r_vs_plan);
    if (r !== null && r < 0) realizedLossTodayR += Math.abs(r);
  }

  const totalOpenR = openPositions;
  const exposures: CurrencyExposure[] = Array.from(byCurrency.entries())
    .map(([currency, positions]) => ({
      currency,
      positions,
      riskR: positions,
      share: totalOpenR > 0 ? positions / totalOpenR : 0,
    }))
    .sort((a, b) => b.riskR - a.riskR || a.currency.localeCompare(b.currency));

  return {
    basis: "trades you logged",
    openPositions,
    pendingPositions,
    openRiskR: openPositions,
    pendingRiskR: pendingPositions,
    openRiskMoney: riskBudget === null ? null : Number((openPositions * riskBudget).toFixed(2)),
    pendingRiskMoney:
      riskBudget === null ? null : Number((pendingPositions * riskBudget).toFixed(2)),
    realizedLossTodayR: Number(realizedLossTodayR.toFixed(4)),
    realizedLossTodayMoney:
      riskBudget === null ? null : Number((realizedLossTodayR * riskBudget).toFixed(2)),
    byCurrency: exposures,
    currency: profile.accountCurrency,
  };
}
