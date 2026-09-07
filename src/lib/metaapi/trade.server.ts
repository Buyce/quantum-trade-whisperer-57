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
 * request. Reached only through the owner's immediate-market-entry opt-in while
 * price is inside the published maximum acceptable entry. There is no
 * expiration: a market order fills or is refused immediately.
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

/**
 * Close PART of an open position at market (`POSITION_PARTIAL`).
 *
 * Used only by the managed demo exit policy, to take the first-target portion off
 * while the remainder runs. `volume` is the amount to CLOSE, already rounded to
 * the broker's volume step by the caller — this function never rounds, because a
 * silently adjusted size would misstate what was actually closed.
 *
 * An `unknown` verdict is left unknown: the caller re-reads the position rather
 * than repeating the close, because a repeat could shut the runner down.
 */
export async function partialClosePosition(
  accountId: string,
  region: string,
  positionId: string,
  volume: number,
): Promise<TradeVerdict> {
  const res = await metaApiRequest<TradeResponse>({
    service: "client",
    region,
    method: "POST",
    label: `partial close ${positionId}`,
    path: `/users/current/accounts/${accountId}/trade`,
    body: { actionType: "POSITION_PARTIAL", positionId, volume },
  });
  return interpretTradeResponse(res);
}

/**
 * Move an open position's stop loss (and optionally its take profit)
 * (`POSITION_MODIFY`). Used to place the remainder's stop at break-even after a
 * partial close. Both prices are sent as given; nothing is inferred.
 */
export async function modifyPositionProtection(
  accountId: string,
  region: string,
  positionId: string,
  stopLoss: number,
  takeProfit?: number,
): Promise<TradeVerdict> {
  const res = await metaApiRequest<TradeResponse>({
    service: "client",
    region,
    method: "POST",
    label: `modify position ${positionId}`,
    path: `/users/current/accounts/${accountId}/trade`,
    body: {
      actionType: "POSITION_MODIFY",
      positionId,
      stopLoss,
      ...(typeof takeProfit === "number" && Number.isFinite(takeProfit) ? { takeProfit } : {}),
    },
  });
  return interpretTradeResponse(res);
}
