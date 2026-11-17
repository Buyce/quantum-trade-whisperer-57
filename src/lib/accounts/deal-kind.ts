import { parseClientId } from "@/lib/evidence/associate";

/** Broker deal types that move money without being a trading result. */
const NON_TRADING = new Set(["DEAL_TYPE_BALANCE", "DEAL_TYPE_CREDIT", "DEAL_TYPE_BONUS"]);

export function isNonTradingDeal(deal: { type?: string | null }): boolean {
  return typeof deal.type === "string" && NON_TRADING.has(deal.type);
}

/**
 * True when P-Trades placed this deal — same positive association broker
 * reconciliation uses (our clientId; magic must match when both are known).
 */
export function isPTradesDeal(
  deal: { clientId?: string | null; magic?: number | null },
  expectedMagic: number | null,
): boolean {
  if (!parseClientId(deal.clientId ?? null)) return false;
  const magic = typeof deal.magic === "number" ? deal.magic : null;
  return !(expectedMagic !== null && magic !== null && magic !== expectedMagic);
}
