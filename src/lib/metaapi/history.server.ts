/**
 * Broker trade history: historical orders and deals in a time range.
 *
 * This is the evidence source for reconciliation — a P-Trades order is only
 * considered filled when a broker DEAL says so, matched by `clientId`.
 */
import { isPTradesClientId } from "./client-id";
import { metaApiRequest } from "./request.server";
import type { BrokerDeal, BrokerOrder } from "./types";

function range(startTime: Date, endTime: Date): string {
  return `${encodeURIComponent(startTime.toISOString())}/${encodeURIComponent(endTime.toISOString())}`;
}

export async function fetchHistoryOrders(
  accountId: string,
  region: string,
  startTime: Date,
  endTime: Date,
): Promise<BrokerOrder[]> {
  const raw = await metaApiRequest<BrokerOrder[]>({
    service: "client",
    region,
    label: "history orders",
    path: `/users/current/accounts/${accountId}/history-orders/time/${range(startTime, endTime)}`,
  });
  return Array.isArray(raw) ? raw : [];
}

export async function fetchDeals(
  accountId: string,
  region: string,
  startTime: Date,
  endTime: Date,
): Promise<BrokerDeal[]> {
  const raw = await metaApiRequest<BrokerDeal[]>({
    service: "client",
    region,
    label: "history deals",
    path: `/users/current/accounts/${accountId}/history-deals/time/${range(startTime, endTime)}`,
  });
  return Array.isArray(raw) ? raw : [];
}

/** Only the deals P-Trades itself owns, by clientId. Manual trades stay out. */
export function ownDeals(deals: BrokerDeal[]): BrokerDeal[] {
  return deals.filter((d) => isPTradesClientId(d.clientId ?? null));
}

/** Only the orders P-Trades itself owns, by clientId. */
export function ownOrders(orders: BrokerOrder[]): BrokerOrder[] {
  return orders.filter((o) => isPTradesClientId(o.clientId ?? null));
}
