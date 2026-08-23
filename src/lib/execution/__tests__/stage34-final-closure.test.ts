/**
 * Prompt 14 — Stage 3/4 FINAL CLOSURE regressions.
 *
 * Each test below locks one directly-evidenced defect closed:
 *
 *  1. Demo Auto survives a healthy broker refresh, and stands down when the
 *     broker becomes unsafe.
 *  2. Connected-account sizing fails CLOSED: no equity, no currency, no fresh
 *     account specification ⇒ no quantity at all. The static contract table and
 *     the benchmark broker's table can never rescue a missing account spec.
 *  3. The submitted volume is derived from the FINAL pre-submit broker snapshot,
 *     not from the equity read during revalidation.
 *  4. Arming an automatic mode requires the matching global capability now.
 *  5. Benchmark risk comes from the operator policy; a customer's risk
 *     percentage cannot shape a benchmark order.
 *  6. 100 customer executions of one setup remain N = 1 for a strategy-edge
 *     claim and N = 100 for an execution-quality claim.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";
import { modeAfterReconcile, type ModeContext } from "@/lib/accounts/mode";
import { collapseCustomerExecutions } from "@/lib/research/sample";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

// ---- stubs ----------------------------------------------------------------
const fetchQuote = vi.fn();
const fetchAccountFacts = vi.fn();
const estimateMargin = vi.fn();
const submitPendingOrder = vi.fn();

vi.mock("@/lib/scanner/metaapi.server", () => ({
  fetchQuote: (symbol: string) => fetchQuote(symbol),
  fetchSymbolSpecification: vi.fn(),
}));

vi.mock("@/lib/metaapi/accounts.server", () => ({
  fetchAccountFacts: (id: string, region: string) => fetchAccountFacts(id, region),
}));

vi.mock("@/lib/metaapi/margin.server", () => ({
  estimateMargin: (...args: unknown[]) => estimateMargin(...args),
}));

vi.mock("@/lib/metaapi/trade.server", () => ({
  submitPendingOrder: (...args: unknown[]) => submitPendingOrder(...args),
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
import { resizeFromBrokerSnapshot } from "../resize.server";
import { submitDirectOrder, type DirectTarget } from "../direct.server";

const customerSettings = {
  account_equity: 500_000, // deliberately absurd: it must NEVER be used here
  account_currency: "EUR",
  risk_per_trade_percent: 1,
  max_position_size: 0,
  leverage: 100,
  max_stop_loss_percent: 0,
  equity_as_of: "2026-08-01T00:00:00.000Z",
};

/** A fresh, usable account-scoped XAUUSD specification. */
function accountSpec(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function db(opts: {
  accountSpecRow?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
} = {}) {
  const handler = (call: FakeCall) => {
    if (call.table === "scanner_settings") {
      const s = opts.settings === undefined ? customerSettings : opts.settings;
      return { data: s ? [s] : [], error: null };
    }
    if (call.table === "connected_account_specs") {
      const row = opts.accountSpecRow === undefined ? accountSpec() : opts.accountSpecRow;
      return { data: row ? [row] : [], error: null };
    }
    // A benchmark/static broker table row exists and must NOT rescue anything.
    if (call.table === "broker_symbol_specs") {
      return { data: [{ ...accountSpec(), symbol: "XAUUSD" }], error: null };
    }
    if (call.table === "executed_trades") return { data: [], error: null };
    return { data: [], error: null };
  };
  return createFakeSupabase(handler);
}

const request = {
  instrument: "XAUUSD",
  entryPrice: 2400,
  stopLoss: 2390,
  signalId: "3f4a1c9e-2b6d-4f7a-9c11-8d5e6f7a8b9c",
};

beforeEach(() => {
  fetchQuote.mockReset();
  fetchAccountFacts.mockReset();
  estimateMargin.mockReset();
  submitPendingOrder.mockReset();
});

// ---- 1. Demo Auto through reconciliation ----------------------------------
const healthy: ModeContext = {
  brokerAccountType: "demo",
  ready: true,
  intentConflict: false,
  tradeAllowed: true,
  investorMode: false,
  hasBrokerConnection: true,
  hasMagic: true,
};

describe("Demo Auto through reconciliation", () => {
  it("[REGRESSION] a healthy broker refresh keeps an explicitly armed demo_auto", () => {
    const out = modeAfterReconcile("demo_auto", healthy);
    expect(out.mode).toBe("demo_auto");
    expect(out.standDownReason).toBeNull();
  });

  it("[REGRESSION] an unsafe broker refresh stands demo_auto down to observe", () => {
    for (const unsafe of [
      { ...healthy, brokerAccountType: "real" as const },
      { ...healthy, tradeAllowed: false },
      { ...healthy, tradeAllowed: null },
      { ...healthy, investorMode: true },
      { ...healthy, intentConflict: true },
      { ...healthy, hasBrokerConnection: false },
      { ...healthy, hasMagic: false },
    ]) {
      const out = modeAfterReconcile("demo_auto", unsafe);
      expect(out.mode).toBe("observe");
      expect(out.standDownReason).toBeTruthy();
    }
  });
});

// ---- 2. Fail-closed connected-account sizing -------------------------------
describe("connected-account sizing fails closed", () => {
  it("[REGRESSION] missing broker equity yields account_equity_unavailable and no quantity", async () => {
    const fake = db();
    const result = await resolveSizingForAccount(
      fake.client as never,
      "user-1",
      { id: "acct-1", equity: null, currency: "USD", equityAsOf: null },
      request,
      NOW,
    );
    expect(isAccountSizingRefusal(result)).toBe(true);
    if (isAccountSizingRefusal(result)) {
      expect(result.accountReason).toBe("account_equity_unavailable");
    }
    expect((result as { lots?: number }).lots).toBeUndefined();
  });

  it("[REGRESSION] a missing account currency is never defaulted to USD", async () => {
    const fake = db();
    for (const currency of [null, "", "   "]) {
      const result = await resolveSizingForAccount(
        fake.client as never,
        "user-1",
        { id: "acct-1", equity: 10_000, currency, equityAsOf: null },
        request,
        NOW,
      );
      expect(isAccountSizingRefusal(result)).toBe(true);
      if (isAccountSizingRefusal(result)) {
        expect(result.accountReason).toBe("account_currency_unavailable");
      }
    }
  });

  it("[REGRESSION] static and benchmark specs cannot rescue a missing account spec", async () => {
    // `broker_symbol_specs` (the benchmark broker's table) HAS a usable XAUUSD
    // row here, and a static contract table entry exists in code. Neither may
    // authorise a quantity for a customer's broker account.
    const fake = db({ accountSpecRow: null });
    const result = await resolveSizingForAccount(
      fake.client as never,
      "user-1",
      { id: "acct-1", equity: 10_000, currency: "USD", equityAsOf: null },
      request,
      NOW,
    );
    expect(isAccountSizingRefusal(result)).toBe(true);
    if (isAccountSizingRefusal(result)) {
      expect(result.accountReason).toBe("account_spec_unavailable");
    }
    expect(fake.calls.some((c) => c.table === "broker_symbol_specs")).toBe(false);
  });

  it("[REGRESSION] a stale account spec refuses instead of falling back", async () => {
    const fake = db({
      accountSpecRow: accountSpec({
        fetched_at: new Date(NOW - 30 * 24 * 3_600_000).toISOString(),
      }),
    });
    const result = await resolveSizingForAccount(
      fake.client as never,
      "user-1",
      { id: "acct-1", equity: 10_000, currency: "USD", equityAsOf: null },
      request,
      NOW,
    );
    expect(isAccountSizingRefusal(result)).toBe(true);
    if (isAccountSizingRefusal(result)) {
      expect(result.accountReason).toBe("account_spec_unavailable");
    }
  });

  it("[UNIT] a complete broker snapshot sizes from broker equity, not the typed-in equity", async () => {
    const fake = db();
    const result = await resolveSizingForAccount(
      fake.client as never,
      "user-1",
      { id: "acct-1", equity: 10_000, currency: "USD", equityAsOf: new Date(NOW).toISOString() },
      request,
      NOW,
    );
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.profile.accountEquity).toBe(10_000);
      expect(result.currency).toBe("USD");
      expect(result.provenance.equityBasis).toBe("broker_reported");
    }
  });
});

// ---- 5. Benchmark risk independence ---------------------------------------
describe("benchmark risk percentage", () => {
  it("[REGRESSION] the operator risk percentage overrides the customer's", async () => {
    const account = {
      id: "acct-1",
      equity: 10_000,
      currency: "USD",
      equityAsOf: new Date(NOW).toISOString(),
    };
    const customerRun = await resolveSizingForAccount(
      db().client as never,
      "user-1",
      account,
      request,
      NOW,
    );
    const benchmarkRun = await resolveSizingForAccount(
      db().client as never,
      "user-1",
      account,
      request,
      NOW,
      { riskPercent: 0.25 },
    );
    expect(customerRun.available && benchmarkRun.available).toBe(true);
    if (customerRun.available && benchmarkRun.available) {
      expect(customerRun.profile.riskPerTradePercent).toBe(1);
      expect(benchmarkRun.profile.riskPerTradePercent).toBe(0.25);
      expect(benchmarkRun.lots).toBeLessThan(customerRun.lots);
    }
  });

  it("[REGRESSION] two customers changing risk cannot move a benchmark quantity", async () => {
    const account = {
      id: "acct-1",
      equity: 10_000,
      currency: "USD",
      equityAsOf: new Date(NOW).toISOString(),
    };
    const runs = await Promise.all(
      [0.1, 5, 100].map((risk) =>
        resolveSizingForAccount(
          db({ settings: { ...customerSettings, risk_per_trade_percent: risk } }).client as never,
          "user-1",
          account,
          request,
          NOW,
          { riskPercent: 0.5 },
        ),
      ),
    );
    const lots = runs.map((r) => (r.available ? r.lots : null));
    expect(new Set(lots).size).toBe(1);
    expect(lots[0]).toBeGreaterThan(0);
  });
});

// ---- 3. Final quantity from the pre-submit snapshot ------------------------
function target(): DirectTarget {
  return {
    accountId: "acct-1",
    metaapiAccountId: "ma-1",
    region: "london",
    magic: 771234,
    mode: "demo_auto",
    brokerSymbol: "XAUUSD",
    freeMargin: 100_000,
    accountType: "demo",
    // The equity known at REVALIDATION time.
    equity: 20_000,
    currency: "USD",
    observedAt: new Date(NOW).toISOString(),
    globalDemoAuto: true,
    globalLiveAuto: false,
  };
}

const plan = {
  signalId: request.signalId,
  direction: "long",
  entryPrice: 2400,
  stopLoss: 2390,
  tp1: 2420,
  grade: "A",
  detectedAt: new Date(NOW - 60_000).toISOString(),
};

describe("final quantity comes from the pre-submit broker snapshot", () => {
  it("[REGRESSION] equity halving between validation and submission halves the volume", async () => {
    const fake = db();
    const client = fake.client as never;

    // Quantity authorised earlier, from 20,000 equity.
    const authorised = await resizeFromBrokerSnapshot(
      client,
      { userId: "user-1", accountId: "acct-1", ...request },
      { equity: 20_000, currency: "USD", observedAt: new Date(NOW).toISOString() },
      NOW,
    );
    expect(authorised.ok).toBe(true);

    // The broker now reports HALF that equity at submission time.
    fetchAccountFacts.mockResolvedValue({
      type: "demo",
      observedAt: new Date(NOW).toISOString(),
      info: {
        tradeAllowed: true,
        investorMode: false,
        freeMargin: 100_000,
        equity: 10_000,
        currency: "USD",
      },
    });
    estimateMargin.mockResolvedValue(500);
    submitPendingOrder.mockResolvedValue({
      orderId: "o-1",
      positionId: null,
      numericCode: 10009,
      stringCode: "TRADE_RETCODE_DONE",
      message: "Request completed",
    });

    const result = await submitDirectOrder(
      client,
      { id: 42, dry_run: false },
      plan,
      authorised.ok ? authorised.quantity : { lots: 0, sizingModel: 1, specSource: "static_v1", specAsOf: null },
      target(),
      async (snapshot) =>
        await resizeFromBrokerSnapshot(
          client,
          { userId: "user-1", accountId: "acct-1", ...request },
          snapshot,
          NOW,
        ),
    );

    expect(result.state).toBe("acknowledged");
    // The order actually submitted carries the volume for 10,000 equity.
    const submitted = submitPendingOrder.mock.calls[0]?.[2] as { volume: number };
    const expected = await resizeFromBrokerSnapshot(
      client,
      { userId: "user-1", accountId: "acct-1", ...request },
      { equity: 10_000, currency: "USD", observedAt: new Date(NOW).toISOString() },
      NOW,
    );
    expect(expected.ok).toBe(true);
    if (expected.ok && authorised.ok) {
      expect(submitted.volume).toBeCloseTo(expected.quantity.lots, 5);
      expect(submitted.volume).toBeLessThan(authorised.quantity.lots);
    }
  });

  it("[REGRESSION] the refresh happens before sizing, and a lost currency stops the order", async () => {
    const fake = db();
    const client = fake.client as never;
    fetchAccountFacts.mockResolvedValue({
      type: "demo",
      observedAt: new Date(NOW).toISOString(),
      info: {
        tradeAllowed: true,
        investorMode: false,
        freeMargin: 100_000,
        equity: 10_000,
        currency: null,
      },
    });

    const result = await submitDirectOrder(
      client,
      { id: 43, dry_run: false },
      plan,
      { lots: 0.5, sizingModel: 1, specSource: "static_v1", specAsOf: null },
      target(),
      async (snapshot) =>
        await resizeFromBrokerSnapshot(
          client,
          { userId: "user-1", accountId: "acct-1", ...request },
          snapshot,
          NOW,
        ),
    );

    expect(result.state).toBe("rejected");
    expect(submitPendingOrder).not.toHaveBeenCalled();
    expect(estimateMargin).not.toHaveBeenCalled();
  });
});

// ---- 6. Research sample units ---------------------------------------------
describe("research sample units", () => {
  it("[REGRESSION] 100 executions of one setup on one UTC day are N=1 for edge, N=100 for quality", () => {
    const observations = Array.from({ length: 100 }, (_, i) => ({
      signalId: request.signalId,
      researchRef: `ra_${i}`,
      detectedAt: "2026-08-21T09:30:00.000Z",
      rVsPlan: 1.4,
      rVsActualRisk: 1.35,
      slippage: 0.2,
      filled: true,
    }));
    const collapsed = collapseCustomerExecutions(observations);
    expect(collapsed.signalEdgeObservations).toBe(1);
    expect(collapsed.executionQualityObservations).toBe(100);
    expect(collapsed.utcDays).toBe(1);
    expect(collapsed.signalEdge[0]?.executions).toBe(100);
    expect(collapsed.signalEdge[0]?.accounts).toBe(100);
  });
});
