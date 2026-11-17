/** Broker deal types that move money without being a trading result. */
const NON_TRADING = new Set(["DEAL_TYPE_BALANCE", "DEAL_TYPE_CREDIT", "DEAL_TYPE_BONUS"]);

export function isNonTradingDeal(deal: { type?: string | null }): boolean {
  return typeof deal.type === "string" && NON_TRADING.has(deal.type);
}
