import { beforeEach, describe, expect, it, vi } from "vitest";

const broker = vi.hoisted(() => ({
  fetchDeals: vi.fn(),
  fetchHistoryOrders: vi.fn(),
  fetchPositions: vi.fn(),
}));

vi.mock("@/lib/metaapi/history.server", () => ({
  fetchDeals: broker.fetchDeals,
  fetchHistoryOrders: broker.fetchHistoryOrders,
}));

vi.mock("@/lib/metaapi/accounts.server", () => ({
  fetchPositions: broker.fetchPositions,
}));

import { reconcileBrokerEvidence } from "../reconcile.server";

interface QueryCall {
  method: string;
  args: unknown[];
}

interface FakeQuery extends PromiseLike<{ data: unknown[]; error: null }> {
  select: (...args: unknown[]) => FakeQuery;
  eq: (...args: unknown[]) => FakeQuery;
  in: (...args: unknown[]) => FakeQuery;
  gte: (...args: unknown[]) => FakeQuery;
  not: (...args: unknown[]) => FakeQuery;
  order: (...args: unknown[]) => FakeQuery;
  range: (...args: unknown[]) => FakeQuery;
}

const oldDelivery = {
  id: 42,
  user_id: "00000000-0000-4000-8000-000000000001",
  signal_id: "00000000-0000-4000-8000-000000000002",
  connected_account_id: "00000000-0000-4000-8000-000000000003",
  client_id: "PTRADES-PTRA-12345678-42",
  magic: 140714,
  broker_symbol: "XAUUSD",
  submitted_entry: 2_500,
  submitted_stop: 2_490,
  submitted_target: 2_520,
  submitted_at: "2026-08-01T09:00:00.000Z",
  account_mode: "demo",
};

function resultFor(table: string, calls: QueryCall[]): { data: unknown[]; error: null } {
  if (table === "broker_trade_evidence") {
    return {
      data: [
        {
          id: "00000000-0000-4000-8000-000000000004",
          delivery_id: oldDelivery.id,
          first_observed_at: "2026-08-01T09:10:00.000Z",
          entry_at: "2026-08-01T09:05:00.000Z",
        },
      ],
      error: null,
    };
  }
  if (table === "execution_deliveries") {
    const recentOnly = calls.some((call) => call.method === "gte");
    return { data: recentOnly ? [] : [oldDelivery], error: null };
  }
  if (table === "connected_trading_accounts") {
    return {
      data: [
        {
          id: oldDelivery.connected_account_id,
          user_id: oldDelivery.user_id,
          metaapi_account_id: "metaapi-account",
          region: "new-york",
          magic: oldDelivery.magic,
          broker_account_type: "demo",
          research_consent: false,
          research_consent_version: null,
          research_consent_at: null,
          research_account_ref: null,
        },
      ],
      error: null,
    };
  }
  return { data: [], error: null };
}

function queryFor(table: string): FakeQuery {
  const calls: QueryCall[] = [];
  const query = {} as FakeQuery;
  for (const method of ["select", "eq", "in", "gte", "not", "order", "range"] as const) {
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  }
  query.then = (resolve, reject) => Promise.resolve(resultFor(table, calls)).then(resolve, reject);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  broker.fetchDeals.mockResolvedValue([]);
  broker.fetchHistoryOrders.mockResolvedValue([]);
  broker.fetchPositions.mockResolvedValue([]);
});

describe("broker evidence reconciliation window", () => {
  it("[INVARIANT] keeps reconciling a broker position that stays open beyond 72 hours", async () => {
    const db = { from: vi.fn((table: string) => queryFor(table)), rpc: vi.fn() };
    const now = Date.parse("2026-08-23T12:00:00.000Z");

    const result = await reconcileBrokerEvidence(db as never, { now });

    expect(result.accountsChecked).toBe(1);
    expect(result.errors).toEqual([]);
    expect(broker.fetchDeals).toHaveBeenCalledOnce();
    expect(broker.fetchDeals.mock.calls[0]?.[2]).toEqual(new Date("2026-08-01T09:00:00.000Z"));
    expect(broker.fetchHistoryOrders.mock.calls[0]?.[2]).toEqual(
      new Date("2026-08-01T09:00:00.000Z"),
    );
  });
});
