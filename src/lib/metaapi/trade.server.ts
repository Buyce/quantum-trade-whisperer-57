/**
 * Trade submission (Client API `trade` endpoint).
 *
 * P-Trades only ever submits PENDING limit orders with both a stop loss and a
 * take profit attached in the same request, so an accepted order can never sit
 * on the broker unprotected. The verdict is interpreted by the pure
 * `interpretTradeResponse` mapper, which keeps "unknown" distinct from
 * "rejected" — the difference between reconciling and duplicating an order.
 */
import { metaApiRequest } from "./request.server";
import { interpretTradeResponse, type TradeVerdict } from "./trade-result";
import type { MarketOrderRequest, PendingOrderRequest, TradeResponse } from "./types";

export async function submitPendingOrder(
  accountId: string,
  region: string,
  order: PendingOrderRequest,
): Promise<TradeVerdict> {
  const res = await metaApiRequest<TradeResponse>({
    service: "client",
    region,
    method: "POST",
    label: `${order.symbol} ${order.actionType}`,
    path: `/users/current/accounts/${accountId}/trade`,
    body: {
      actionType: order.actionType,
      symbol: order.symbol,
      volume: order.volume,
      openPrice: order.openPrice,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      expiration: { type: "ORDER_TIME_SPECIFIED", time: order.expirationTime },
      clientId: order.clientId,
      magic: order.magic,
      ...(order.comment ? { comment: order.comment } : {}),
    },
  });
  return interpretTradeResponse(res);
}

/**
 * Submit a MARKET order, with stop loss and take profit attached in the same
 * request. Reached only through the owner's opt-in market-entry setting, when
 * price has passed the planned entry but is still inside the maximum acceptable
 * entry. There is no expiration: a market order fills or is refused immediately.
 */
export async function submitMarketOrder(
  accountId: string,
  region: string,
  order: MarketOrderRequest,
): Promise<TradeVerdict> {
  const res = await metaApiRequest<TradeResponse>({
    service: "client",
    region,
    method: "POST",
    label: `${order.symbol} ${order.actionType}`,
    path: `/users/current/accounts/${accountId}/trade`,
    body: {
      actionType: order.actionType,
      symbol: order.symbol,
      volume: order.volume,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      clientId: order.clientId,
      magic: order.magic,
      ...(order.comment ? { comment: order.comment } : {}),
    },
  });
  return interpretTradeResponse(res);
}

/** Cancel a pending order that P-Trades placed. */
export async function cancelOrder(
  accountId: string,
  region: string,
  orderId: string,
): Promise<TradeVerdict> {
  const res = await metaApiRequest<TradeResponse>({
    service: "client",
    region,
    method: "POST",
    label: `cancel order ${orderId}`,
    path: `/users/current/accounts/${accountId}/trade`,
    body: { actionType: "ORDER_CANCEL", orderId },
  });
  return interpretTradeResponse(res);
}
