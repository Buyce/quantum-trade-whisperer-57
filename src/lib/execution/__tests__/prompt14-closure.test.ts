/**
 * Prompt 14 FINAL COMPLETION regressions.
 *
 * Each test below locks one directly-evidenced defect closed:
 *
 *  1. Broker equity freshness is a HARD gate on connected-account sizing: an
 *     equity observation with no time, or one older than the sizing bound,
 *     produces no quantity at all rather than a quantity sized from an unknown
 *     moment in the account's history.
 *  2. Without a pre-submit resizer, a material equity move between authorisation
 *     and submission REFUSES. The previously-authorised volume is never sent.
 *  3. The account-wide BROKER exposure boundary is actually applied at
 *     submission, and fails closed when the broker cannot be read.
 */
import { describe, expect, it, vi } from "vitest";

import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";
import { BROKER_EQUITY_MAX_AGE_MS, equityFresh, materialEquityChange } from "../equity-freshness";
import { evaluateAccountExposure } from "../exposure-account";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

const fetchAccountFacts = vi.fn();
const estimateMargin = vi.fn();
const submitPendingOrder = vi.fn();
const fetchPositions = vi.fn();
const fetchOrders = vi.fn();

vi.mock("@/lib/metaapi/accounts.server", () => ({
  fetchAccountFacts: (id: string, region: string) => fetchAccountFacts(id, region),
  fetchPositions: (id: string, region: string) => fetchPositions(id, region),
  fetchOrders: (id: string, region: string) => fetchOrders(id, region),
}));
vi.mock("@/lib/metaapi/margin.server", () => ({
  estimateMargin: (...args: unknown[]) => estimateMargin(...args),
}));
vi.mock("@/lib/metaapi/trade.server", () => ({
  submitPendingOrder: (...args: unknown[]) => submitPendingOrder(...args),
}));

vi.mock("@/lib/instruments/lifecycle.server", () => ({
  assertCapability: vi.fn(async () => ({
    allowed: true,
    stage: "execution_approved",
    reason: null,
  })),
}));
vi.mock("@/lib/scanner/metaapi.server", () => ({
  fetchQuote: vi.fn(),
  fetchSymbolSpecification: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from() {
      return {
        select: () => ({
          maybeSingle: () => Promise.resolve({ data: { sizing_v2_enabled: false }, error: null }),
        }),
        insert: () => Promise.resolve({ data: null, error: null }),
      };
    },
  },
}));

import { resolveSizingForAccount, isAccountSizingRefusal } from "@/lib/sizing/service.server";
import { submitDirectOrder, type DirectTarget } from "../direct.server";

const request = {
  instrument: "XAUUSD",
  entryPrice: 2400,
  stopLoss: 2390,
  signalId: "11111111-1111-4111-8111-111111111111",
};

function accountSpec() {
  return {
    broker_symbol: "XAUUSD",
    canonical_symbol: "XAUUSD",
    contract_size: 100,
    tick_size: 0.01,
    tick_value: 1,
    point: 0.01,
    point_source: "derived_from_digits",
    digits: 2,
    volume_min: 0.01,
    volume_max: 100,
    volume_step: 0.01,
    volume_limit: null,
    stops_level: 0,
    freeze_level: 0,
    base_currency: "XAU",
    profit_currency: "USD",
    margin_currency: "USD",
    trade_mode: "SYMBOL_TRADE_MODE_FULL",
    calc_mode: "SYMBOL_CALC_MODE_CFDLEVERAGE",
    fetched_at: new Date(NOW - 3_600_000).toISOString(),
  };
}

function db() {
  const handler = (call: FakeCall) => {
    if (call.table === "scanner_settings") {
      return {
        data: [
          {
            account_equity: 10_000,
            account_currency: "USD",
            risk_per_trade_percent: 1,
            max_position_size: 0,
            leverage: 100,
            max_stop_loss_percent: 0,
            equity_as_of: new Date(NOW).toISOString(),
          },
        ],
        error: null,
      };
    }
    if (call.table === "connected_account_specs") return { data: [accountSpec()], error: null };
    return { data: [], error: null };
  };
  return createFakeSupabase(handler);
}

// ---- 1. Equity freshness is a hard sizing gate -----------------------------
describe("broker equity freshness", () => {
  it("[UNIT] a missing or unreadable observation time is never fresh", () => {
    expect(equityFresh(null, NOW).fresh).toBe(false);
    expect(equityFresh("not a date", NOW).fresh).toBe(false);
    expect(equityFresh(new Date(NOW + 10 * 60_000).toISOString(), NOW).fresh).toBe(false);
    expect(equityFresh(new Date(NOW - 60_000).toISOString(), NOW).fresh).toBe(true);
  });

  it("[INVARIANT] connected-account sizing refuses when equity has no observation time", async () => {
    const result = await resolveSizingForAccount(
      db().client as never,
      "user-1",
      { id: "acct-1", equity: 10_000, currency: "USD", equityAsOf: null },
      request,
      NOW,
    );
    expect(isAccountSizingRefusal(result)).toBe(true);
    if (isAccountSizingRefusal(result)) {
      expect(result.accountReason).toBe("account_equity_stale");
    }
  });

  it("[INVARIANT] connected-account sizing refuses when equity is older than the sizing bound", async () => {
    const stale = new Date(NOW - BROKER_EQUITY_MAX_AGE_MS - 60_000).toISOString();
    const result = await resolveSizingForAccount(
      db().client as never,
      "user-1",
      { id: "acct-1", equity: 10_000, currency: "USD", equityAsOf: stale },
      request,
      NOW,
    );
    expect(isAccountSizingRefusal(result)).toBe(true);
    if (isAccountSizingRefusal(result)) {
      expect(result.accountReason).toBe("account_equity_stale");
    }
  });

  it("[UNIT] a fresh observation authorises a quantity", async () => {
    const result = await resolveSizingForAccount(
      db().client as never,
      "user-1",
      { id: "acct-1", equity: 10_000, currency: "USD", equityAsOf: new Date(NOW).toISOString() },
      request,
      NOW,
    );
    expect(result.available).toBe(true);
  });
});

// ---- 2 + 3. Submission-time gates ------------------------------------------
function target(overrides: Partial<DirectTarget> = {}): DirectTarget {
  return {
    accountId: "acct-1",
    metaapiAccountId: "ma-1",
    region: "london",
    magic: 771234,
    mode: "demo_auto",
    brokerSymbol: "XAUUSD",
    freeMargin: 100_000,
    accountType: "demo",
    equity: 20_000,
    currency: "USD",
    observedAt: new Date(NOW).toISOString(),
    globalDemoAuto: true,
    globalLiveAuto: false,
    ...overrides,
  };
}

const plan = {
  signalId: request.signalId,
  instrument: request.instrument,
  direction: "long",
  entryPrice: 2400,
  stopLoss: 2390,
  tp1: 2420,
  grade: "A",
  detectedAt: new Date(NOW - 60_000).toISOString(),
};

const quantity = {
  lots: 0.2,
  sizingModel: 1 as const,
  specSource: "static_v1" as const,
  specAsOf: null,
};

function healthyBroker(equity: number) {
  fetchAccountFacts.mockResolvedValue({
    type: "demo",
    observedAt: new Date(NOW).toISOString(),
    info: {
      tradeAllowed: true,
      investorMode: false,
      freeMargin: 100_000,
      equity,
      currency: "USD",
    },
  });
  estimateMargin.mockResolvedValue(500);
  submitPendingOrder.mockResolvedValue({
    outcome: "accepted",
    orderId: "o-1",
    positionId: null,
    numericCode: 10009,
    stringCode: "TRADE_RETCODE_DONE",
    message: "Request completed",
  });
}

describe("material equity movement without a resizer", () => {
  it("[UNIT] the pure rule treats an unusable equity as material", () => {
    expect(materialEquityChange(null, 10_000).material).toBe(true);
    expect(materialEquityChange(10_000, null).material).toBe(true);
    expect(materialEquityChange(10_000, 10_010).material).toBe(false);
    expect(materialEquityChange(20_000, 10_000).material).toBe(true);
  });

  it("[INVARIANT] a halved equity refuses instead of submitting the authorised volume", async () => {
    vi.clearAllMocks();
    healthyBroker(10_000);
    const result = await submitDirectOrder(
      db().client as never,
      { id: 51, dry_run: false },
      plan,
      quantity,
      target({ equity: 20_000 }),
    );
    expect(result.state).toBe("rejected");
    expect(submitPendingOrder).not.toHaveBeenCalled();
  });

  it("[UNIT] an unchanged equity still submits", async () => {
    vi.clearAllMocks();
    healthyBroker(20_000);
    const result = await submitDirectOrder(
      db().client as never,
      { id: 52, dry_run: false },
      plan,
      quantity,
      target({ equity: 20_000 }),
    );
    expect(result.state).toBe("acknowledged");
    expect(submitPendingOrder).toHaveBeenCalledTimes(1);
  });
});

describe("account-wide broker exposure boundary", () => {
  it("[UNIT] the pure rule counts the order about to be sent and fails closed", () => {
    expect(
      evaluateAccountExposure(
        { readable: true, openPositions: 0, pendingOrders: 0 },
        {
          maxAccountOpenPositions: 1,
        },
      ).allowed,
    ).toBe(true);
    expect(
      evaluateAccountExposure(
        { readable: true, openPositions: 1, pendingOrders: 0 },
        {
          maxAccountOpenPositions: 1,
        },
      ).allowed,
    ).toBe(false);
    expect(
      evaluateAccountExposure(
        { readable: false, openPositions: 0, pendingOrders: 0 },
        {
          maxAccountOpenPositions: 5,
        },
      ).allowed,
    ).toBe(false);
  });

  it("[INVARIANT] a configured boundary already met at the broker refuses the submission", async () => {
    vi.clearAllMocks();
    healthyBroker(20_000);
    fetchPositions.mockResolvedValue([{ id: "p1" }]);
    fetchOrders.mockResolvedValue([]);
    const result = await submitDirectOrder(
      db().client as never,
      { id: 53, dry_run: false },
      plan,
      quantity,
      target({ maxAccountOpenPositions: 1 }),
    );
    expect(result.state).toBe("rejected");
    expect(submitPendingOrder).not.toHaveBeenCalled();
  });

  it("[INVARIANT] an unreadable broker refuses rather than assuming the account is flat", async () => {
    vi.clearAllMocks();
    healthyBroker(20_000);
    fetchPositions.mockRejectedValue(new Error("broker unreachable"));
    fetchOrders.mockResolvedValue([]);
    const result = await submitDirectOrder(
      db().client as never,
      { id: 54, dry_run: false },
      plan,
      quantity,
      target({ maxAccountOpenPositions: 5 }),
    );
    expect(result.state).toBe("rejected");
    expect(submitPendingOrder).not.toHaveBeenCalled();
  });

  it("[UNIT] no configured boundary spends no broker request", async () => {
    vi.clearAllMocks();
    healthyBroker(20_000);
    const result = await submitDirectOrder(
      db().client as never,
      { id: 55, dry_run: false },
      plan,
      quantity,
      target({ maxAccountOpenPositions: null }),
    );
    expect(result.state).toBe("acknowledged");
    expect(fetchPositions).not.toHaveBeenCalled();
  });
});
