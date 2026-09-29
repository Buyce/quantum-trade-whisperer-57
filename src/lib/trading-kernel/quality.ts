export interface ClosedTradeR {
  /** Gross result before execution/financing costs, expressed in R. */
  grossR: number;
  /** Spread + commission + slippage + financing attributable to the trade, in R. */
  costsR: number;
}

export interface BotQualityMetrics {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  cumulativeNetR: number;
  maxDrawdownR: number;
}

const round = (value: number, dp = 4) => Number(value.toFixed(dp));

/**
 * Descriptive performance accounting after trading costs.
 * This produces metrics, not a promotion or execution verdict.
 */
export function calculateBotQuality(trades: readonly ClosedTradeR[]): BotQualityMetrics {
  const net = trades
    .filter((t) => Number.isFinite(t.grossR) && Number.isFinite(t.costsR) && t.costsR >= 0)
    .map((t) => t.grossR - t.costsR);

  const wins = net.filter((r) => r > 0);
  const losses = net.filter((r) => r < 0);
  const breakeven = net.length - wins.length - losses.length;
  const sumWins = wins.reduce((sum, r) => sum + r, 0);
  const sumLosses = losses.reduce((sum, r) => sum + Math.abs(r), 0);

  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const r of net) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }

  return {
    trades: net.length,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    winRate: net.length ? round(wins.length / net.length) : null,
    averageWinR: wins.length ? round(sumWins / wins.length) : null,
    averageLossR: losses.length ? round(sumLosses / losses.length) : null,
    expectancyR: net.length ? round(net.reduce((sum, r) => sum + r, 0) / net.length) : null,
    profitFactor: losses.length ? round(sumWins / sumLosses) : wins.length ? Infinity : null,
    cumulativeNetR: round(equity),
    maxDrawdownR: round(maxDrawdownR),
  };
}
