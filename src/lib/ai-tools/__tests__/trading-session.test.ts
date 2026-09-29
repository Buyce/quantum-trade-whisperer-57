import { describe, expect, it, vi } from "vitest";
import { grantAllows, protectionOk, scaleLots, type Grant } from "../trading";
import {
  runArmAccount,
  runClosePosition,
  runPlaceOrder,
  type TradingDeps,
} from "../trading.server";

const NOW = Date.parse("2026-09-28T10:00:00Z");
const ACC = "11111111-1111-4111-8111-111111111111";

const grant = (over: Partial<Grant> = {}): Grant => ({
  id: "22222222-2222-4222-8222-222222222222",
  user_id: "u1",
  client_id: "chatgpt",
  account_ids: [ACC],
  actions: ["place", "modify", "close", "arm"],
  include_live: false,
  max_orders: 5,
  orders_used: 0,
  max_risk_percent: 0.5,
  expires_at: new Date(NOW + 3_600_000).toISOString(),
  revoked_at: null,
  ...over,
});

/** Minimal chainable fake of the admin client. */
function fakeAdmin(opts: {
  grant: Grant | null;
  account: Record<string, unknown>;
  consumed?: boolean;
}) {
  const inserted: unknown[] = [];
  const builder = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of [
      "select",
      "eq",
      "is",
      "gt",
      "gte",
      "lte",
      "in",
      "order",
      "limit",
      "contains",
      "update",
    ])
      q[m] = chain;
    q["insert"] = (row: unknown) => {
      inserted.push({ table, row });
      return q;
    };
    const result = () => {
      if (table === "ai_trading_grants") return { data: opts.grant ? [opts.grant] : [] };
      if (table === "connected_trading_accounts") return { data: opts.account };
      if (table === "execution_controls") return { data: { live_execution_enabled: true } };
      if (table === "ai_trade_actions") return { data: [] };
      return { data: null };
    };
    q["maybeSingle"] = async () => result();
    q["single"] = async () => ({ data: { id: 7 } });
    q["then"] = (res: (v: unknown) => unknown) => res(result());
    return q;
  };
  return {
    inserted,
    from: builder,
    rpc: async () => ({ data: opts.consumed ?? true }),
  };
}

const demoAccount = {
  id: ACC,
  label: "Demo 1",
  metaapi_account_id: "m1",
  region: "london",
  magic: 42,
  broker_account_type: "demo",
  intent: "demo",
  emergency_stop_at: null,
  disconnected_at: null,
  broker_server: null,
};

function deps(admin: unknown, over: Partial<TradingDeps> = {}): TradingDeps {
  const verdict = {
    outcome: "accepted" as const,
    numericCode: 10009,
    stringCode: null,
    message: "ok",
    orderId: "o1",
    positionId: null,
    safeToResubmit: false,
  };
  return {
    admin: async () => admin,
    runValidation: vi.fn(async () => ({
      passed: true,
      lots: 1,
      risk_percent: 1,
      broker_symbol: "EURUSD",
      gates: [],
    })),
    resolveBrokerSymbol: async () => "EURUSD",
    quote: async () => ({ bid: 1.1, ask: 1.1002 }),
    spec: async () => ({ lotStep: 0.01, minLot: 0.01 }),
    positions: async () => [
      { id: "p1", type: "POSITION_TYPE_BUY", volume: 0.5, currentPrice: 1.1 },
    ],
    orders: async () => [],
    submitMarket: vi.fn(async () => verdict),
    submitPending: vi.fn(async () => verdict),
    modifyPosition: vi.fn(async () => verdict),
    closeFull: vi.fn(async () => verdict),
    closePartial: vi.fn(async () => verdict),
    modifyOrder: vi.fn(async () => verdict),
    arm: vi.fn(async (_u, _a, m) => ({ mode: m })),
    now: () => NOW,
    ...over,
  };
}

const order = {
  account_id: ACC,
  instrument: "EURUSD",
  direction: "long",
  order_type: "market",
  stop_loss: 1.098,
  take_profit: 1.105,
};

describe("AI trading sessions", () => {
  it("[UNIT] refuses without a grant, wrong client, expired, revoked, wrong account, cap, live", () => {
    const q = {
      action: "place" as const,
      accountId: ACC,
      isLive: false,
      clientId: "chatgpt",
      now: NOW,
    };
    expect(grantAllows(null, q).ok).toBe(false);
    expect(grantAllows(grant(), { ...q, clientId: "claude" }).ok).toBe(false);
    expect(grantAllows(grant({ expires_at: new Date(NOW - 1).toISOString() }), q).ok).toBe(false);
    expect(grantAllows(grant({ revoked_at: new Date(NOW).toISOString() }), q).ok).toBe(false);
    expect(grantAllows(grant(), { ...q, accountId: "x" }).ok).toBe(false);
    expect(grantAllows(grant({ orders_used: 5 }), q).ok).toBe(false);
    expect(grantAllows(grant(), { ...q, isLive: true }).ok).toBe(false);
    expect(grantAllows(grant({ actions: ["close"] }), q).ok).toBe(false);
    expect(grantAllows(grant(), q).ok).toBe(true);
  });

  it("[UNIT] protection sides and lot scaling never exceed the broker-derived size", () => {
    expect(protectionOk("long", 1.1, 1.2, 1.3).ok).toBe(false);
    expect(protectionOk("short", 1.1, 1.2, 1.0).ok).toBe(true);
    expect(scaleLots(1, 2, 0.01, 0.01)).toBe(1);
    expect(scaleLots(1, 0.5, 0.01, 0.01)).toBe(0.5);
    expect(scaleLots(0.01, 0.5, 0.01, 0.01)).toBeNull();
  });

  it("[UNIT] no grant means nothing reaches the broker", async () => {
    const d = deps(fakeAdmin({ grant: null, account: demoAccount }));
    const r = await runPlaceOrder("u1", "chatgpt", order, d);
    expect(r.isError).toBe(true);
    expect(d.submitMarket).not.toHaveBeenCalled();
    expect(d.runValidation).not.toHaveBeenCalled();
  });

  it("[UNIT] size comes from sizing scaled to the session risk, not from input", async () => {
    const d = deps(fakeAdmin({ grant: grant(), account: demoAccount }));
    const r = await runPlaceOrder("u1", "chatgpt", { ...order, volume: 50 }, d);
    expect(r.isError).toBeUndefined();
    const sent = (d.submitMarket as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as {
      volume: number;
    };
    expect(sent.volume).toBe(0.5); // 1 lot at 1% policy, capped to 0.5% session risk
  });

  it("[UNIT] a failed safety check or missing stop refuses the order", async () => {
    const d = deps(fakeAdmin({ grant: grant(), account: demoAccount }), {
      runValidation: vi.fn(async () => ({
        passed: false,
        lots: null,
        risk_percent: null,
        broker_symbol: null,
        gates: [{ gate: "margin", status: "FAIL", reason: "no margin" }],
      })),
    });
    expect((await runPlaceOrder("u1", "chatgpt", order, d)).isError).toBe(true);
    expect(
      (await runPlaceOrder("u1", "chatgpt", { ...order, stop_loss: undefined }, d)).isError,
    ).toBe(true);
    expect(d.submitMarket).not.toHaveBeenCalled();
  });

  it("[UNIT] live account refused unless the session includes live", async () => {
    const live = { ...demoAccount, broker_account_type: "real", intent: "live" };
    const d = deps(fakeAdmin({ grant: grant(), account: live }));
    expect((await runPlaceOrder("u1", "chatgpt", order, d)).isError).toBe(true);
    expect(d.submitMarket).not.toHaveBeenCalled();
  });

  it("[UNIT] emergency stop blocks new orders but still allows closing", async () => {
    const stopped = { ...demoAccount, emergency_stop_at: new Date(NOW).toISOString() };
    const d = deps(fakeAdmin({ grant: grant(), account: stopped }));
    expect((await runPlaceOrder("u1", "chatgpt", order, d)).isError).toBe(true);
    expect(
      (await runClosePosition("u1", "chatgpt", { account_id: ACC, position_id: "p1" }, d)).isError,
    ).toBeUndefined();
    expect(d.closeFull).toHaveBeenCalled();
  });

  it("[UNIT] live auto can never be armed by an AI", async () => {
    const d = deps(fakeAdmin({ grant: grant(), account: demoAccount }));
    expect(
      (await runArmAccount("u1", "chatgpt", { account_id: ACC, mode: "live_auto" }, d)).isError,
    ).toBe(true);
    expect(d.arm).not.toHaveBeenCalled();
  });
});
