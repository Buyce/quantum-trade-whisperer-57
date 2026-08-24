/**
 * Client API reads about a connected trading account: account information,
 * open positions and open orders.
 *
 * These are the AUTHORITATIVE source for whether an account is demo or real,
 * tradable or investor-only. The user's stated intent is never consulted here.
 */
import { classifyAccountType, type AccountType } from "./classify";
import { metaApiRequest } from "./request.server";
import type { BrokerAccountInformation, BrokerOrder, BrokerPosition } from "./types";

export async function fetchAccountInformation(
  accountId: string,
  region: string,
): Promise<BrokerAccountInformation | null> {
  return await metaApiRequest<BrokerAccountInformation>({
    service: "client",
    region,
    label: "account information",
    path: `/users/current/accounts/${accountId}/account-information`,
  });
}

export interface AccountFacts {
  info: BrokerAccountInformation;
  type: AccountType;
  observedAt: string;
}

/**
 * Account information plus its derived classification. Returns `null` when
 * MetaApi produced no payload — an absent answer, never a default one.
 */
export async function fetchAccountFacts(
  accountId: string,
  region: string,
): Promise<AccountFacts | null> {
  const info = await fetchAccountInformation(accountId, region);
  if (!info || typeof info !== "object") return null;
  return { info, type: classifyAccountType(info), observedAt: new Date().toISOString() };
}

export async function fetchPositions(accountId: string, region: string): Promise<BrokerPosition[]> {
  const raw = await metaApiRequest<BrokerPosition[]>({
    service: "client",
    region,
    label: "positions",
    path: `/users/current/accounts/${accountId}/positions`,
  });
  return Array.isArray(raw) ? raw : [];
}

export async function fetchOrders(accountId: string, region: string): Promise<BrokerOrder[]> {
  const raw = await metaApiRequest<BrokerOrder[]>({
    service: "client",
    region,
    label: "orders",
    path: `/users/current/accounts/${accountId}/orders`,
  });
  return Array.isArray(raw) ? raw : [];
}
