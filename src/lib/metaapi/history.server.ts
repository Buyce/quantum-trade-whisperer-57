/**
 * Broker trade history: historical orders and deals in a time range.
 *
 * This is the evidence source for reconciliation — a P-Trades order is only
 * considered filled when a broker DEAL says so, matched by `clientId`.
 */
import { isPTradesClientId } from "./client-id";
import { metaApiRequest } from "./request.server";
import type { BrokerDeal, BrokerOrder } from "./types";

/** MetaApi documents 1,000 as the maximum history page size. */
export const HISTORY_PAGE_SIZE = 1_000;
/**
 * A reconciliation pass must be bounded, but it must never silently return a
 * partial population. Hitting this guard throws and the evidence worker records
 * the source as unavailable instead of publishing incomplete broker evidence.
 */
export const HISTORY_MAX_PAGES = 10;

function range(startTime: Date, endTime: Date): string {
  return `${encodeURIComponent(startTime.toISOString())}/${encodeURIComponent(endTime.toISOString())}`;
}

export async function fetchHistoryOrders(
  accountId: string,
  region: string,
  startTime: Date,
  endTime: Date,
): Promise<BrokerOrder[]> {
  return await fetchHistoryPages<BrokerOrder>({
    accountId,
    region,
    startTime,
    endTime,
    resource: "history-orders",
    label: "history orders",
  });
}

export async function fetchDeals(
  accountId: string,
  region: string,
  startTime: Date,
  endTime: Date,
): Promise<BrokerDeal[]> {
  return await fetchHistoryPages<BrokerDeal>({
    accountId,
    region,
    startTime,
    endTime,
    resource: "history-deals",
    label: "history deals",
  });
}

async function fetchHistoryPages<T>(input: {
  accountId: string;
  region: string;
  startTime: Date;
  endTime: Date;
  resource: "history-orders" | "history-deals";
  label: string;
}): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    const offset = page * HISTORY_PAGE_SIZE;
    const raw = await metaApiRequest<T[]>({
      service: "client",
      region: input.region,
      label: `${input.label} page ${page + 1}`,
      path:
        `/users/current/accounts/${input.accountId}/${input.resource}/time/` +
        `${range(input.startTime, input.endTime)}?offset=${offset}&limit=${HISTORY_PAGE_SIZE}`,
    });
    const pageRows = Array.isArray(raw) ? raw : [];
    rows.push(...pageRows);
    if (pageRows.length < HISTORY_PAGE_SIZE) return rows;
  }

  throw new Error(
    `MetaApi ${input.label} exceeded ${HISTORY_MAX_PAGES * HISTORY_PAGE_SIZE} rows; refusing a partial reconciliation`,
  );
}

/** Only the deals P-Trades itself owns, by clientId. Manual trades stay out. */
export function ownDeals(deals: BrokerDeal[]): BrokerDeal[] {
  return deals.filter((d) => isPTradesClientId(d.clientId ?? null));
}

/** Only the orders P-Trades itself owns, by clientId. */
export function ownOrders(orders: BrokerOrder[]): BrokerOrder[] {
  return orders.filter((o) => isPTradesClientId(o.clientId ?? null));
}
