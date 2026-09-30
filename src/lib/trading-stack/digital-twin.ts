import { calculateBotQuality, type ClosedTradeR } from "@/lib/trading-kernel/quality";

export interface TwinTrade {
  grossR: number;
  spreadR: number;
  slippageR: number;
  commissionR: number;
  rejected: boolean;
}

export interface TwinResult {
  version: 1;
  mode: "shadow";
  executionEligible: false;
  attempted: number;
  rejected: number;
  resolved: number;
  expectancyR: number | null;
  cumulativeNetR: number;
  maxDrawdownR: number;
}

/**
 * Cost-aware deterministic replay summary.
 *
 * This does not synthesize fills. Callers must supply measured/replay-derived
 * gross R and explicit cost assumptions with provenance.
 */
export function runDigitalTwin(trades: readonly TwinTrade[]): TwinResult {
  const resolved: ClosedTradeR[] = [];
  let rejected = 0;
  for (const trade of trades) {
    if (trade.rejected) {
      rejected += 1;
      continue;
    }
    const values = [trade.grossR, trade.spreadR, trade.slippageR, trade.commissionR];
    if (!values.every(Number.isFinite)) continue;
    resolved.push({
      grossR: trade.grossR,
      costsR:
        Math.max(0, trade.spreadR) + Math.max(0, trade.slippageR) + Math.max(0, trade.commissionR),
    });
  }
  const metrics = calculateBotQuality(resolved);
  return {
    version: 1,
    mode: "shadow",
    executionEligible: false,
    attempted: trades.length,
    rejected,
    resolved: metrics.trades,
    expectancyR: metrics.expectancyR,
    cumulativeNetR: metrics.cumulativeNetR,
    maxDrawdownR: metrics.maxDrawdownR,
  };
}
