import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/metaapi/trade.server", () => {
  const boom = vi.fn(() => {
    throw new Error("trade endpoint must never be called");
  });
  return {
    submitPendingOrder: boom,
    submitMarketOrder: boom,
    cancelOrder: boom,
    partialClosePosition: boom,
    modifyPositionProtection: boom,
  };
});

import * as trade from "@/lib/metaapi/trade.server";
import { runRuntimeValidation, type RuntimeValidationDeps } from "../runtime.server";
import { sanitizeReport } from "../report";

const NOW = Date.parse("2026-09-28T04:00:00Z");
const ACCOUNT = "11111111-1111-1111-1111-111111111111";

function fakeDb(opts: { discrepancies?: { severity: string }[] } = {}) {
  const writes: string[] = [];
  const rows: Record<string, unknown> = {
    connected_trading_accounts: {
      id: ACCOUNT,
      user_id: "u1",
      label: "Demo 1",
      metaapi_account_id: "SECRET-META-ID",
      region: "london",
      connection_status: "CONNECTED",
      provisioning_state: "DEPLOYED",
      disconnected_at: null,
      broker_server: "Demo-Server",
      // Armed for live auto, as if every switch were on.
      mode: "live_auto",
    },
    connected_account_risk_policies: { id: "pol-1" },
  };
  const db = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain,
        eq: chain,
        in: chain,
        order: chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (res: (v: unknown) => void) =>
          res({ data: table === "reconciliation_discrepancies" ? (opts.discrepancies ?? []) : [], error: null }),
        insert: () => {
          writes.push(table);
          return q;
        },
        update: () => {
          writes.push(table);
          return q;
        },
        upsert: () => {
          writes.push(table);
          return q;
        },
        delete: () => {
          writes.push(table);
          return q;
        },
      });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { db: db as never, writes };
}

function deps(over: Partial<RuntimeValidationDeps> = {}): RuntimeValidationDeps & { calls: string[] } {
  const calls: string[] = [];
  const d: RuntimeValidationDeps = {
    now: () => NOW,
    fetchAccountFacts: async () => {
      calls.push("GET account-information");
      return {
        info: { balance: 10000, equity: 10050, freeMargin: 9000, currency: "USD", tradeAllowed: true, investorMode: false },
        type: "demo",
        observedAt: new Date(NOW).toISOString(),
      };
    },
    fetchQuoteFor: async () => {
      calls.push("GET current-price");
      return { bid: 1.1, ask: 1.1002, sourceTime: new Date(NOW).toISOString(), receivedAt: new Date(NOW).toISOString() };
    },
    estimateMargin: async () => {
      calls.push("POST calculate-margin");
      return 220;
    },
    accountExecutionPolicy: async () => ({ ok: true, riskPercent: 1, status: "allow", reasons: [], newsTradingAllowed: null }),
    loadAccountSizingSpec: async () => ({ symbol: "EURUSD.a" }) as never,
    accountSpecStale: () => false,
    resolveMapping: async () =>
      ({ canonical: "EURUSD", providerSymbol: "EURUSD.a", usable: true, status: "exact", refusal: null, detail: "" }) as never,
    resizeFromBrokerSnapshot: async () => ({
      ok: true,
      quantity: { lots: 0.5, sizingModel: 2, specSource: "broker" } as never,
      equityUsed: 10050,
      risk: { amount: 100.5, currency: "USD", percentOfEquity: 1 },
    }),
    ...over,
  };
  return Object.assign(d, { calls });
}

const input = { accountId: ACCOUNT, symbol: "eurusd", direction: "long" as const, stopDistance: 0.002 };

describe("runtime validation is non-trading", () => {
  it("[UNIT] passes every gate on an armed account without touching trade endpoints or writing", async () => {
    const { db, writes } = fakeDb();
    const d = deps();
    const r = await runRuntimeValidation(db, input, d);
    expect(r.passed).toBe(true);
    expect(r.dry_run).toBe(true);
    expect(r.trade_endpoint_called).toBe(false);
    expect(r.lots).toBe(0.5);
    expect(r.required_margin).toBe(220);
    expect(r.policy_id).toBe("pol-1");
    expect(d.calls).toEqual(["GET account-information", "GET current-price", "POST calculate-margin"]);
    for (const fn of Object.values(trade)) expect(fn).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("[UNIT] never leaks the MetaApi account id or secrets", async () => {
    const { db } = fakeDb();
    const r = await runRuntimeValidation(db, input, deps());
    const text = JSON.stringify(r);
    expect(text).not.toContain("SECRET-META-ID");
    expect(text).not.toMatch(/token|password|secret|metaapi_account_id/i);
    const s = sanitizeReport({ account_id: "x", canonical_symbol: "X", token: "t", password: "p" });
    expect(Object.keys(s)).not.toContain("token");
    expect(Object.keys(s)).not.toContain("password");
  });

  it("[UNIT] module graph does not import trade, arm, or delivery send paths", () => {
    const src = readFileSync(resolve(__dirname, "../runtime.server.ts"), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const bad of ["trade.server", "arm.server", "dispatch", "send"])
      expect(imports.some((i) => i!.includes(bad))).toBe(false);
    expect(src).not.toMatch(/submitPendingOrder|submitMarketOrder|cancelOrder|\/trade\b/);
  });
});

describe("runtime validation fails closed", () => {
  const cases: [string, Partial<RuntimeValidationDeps>, string][] = [
    [
      "account_permissions",
      {
        fetchAccountFacts: async () => ({
          info: { equity: 1000, tradeAllowed: true, investorMode: true },
          type: "demo",
          observedAt: new Date(NOW).toISOString(),
        }),
      },
      "investor",
    ],
    ["risk_policy", { accountExecutionPolicy: async () => ({ ok: false, reason: "account_risk_policy", detail: "account risk policy is not configured" }) }, "not configured"],
    [
      "symbol_mapping",
      { resolveMapping: async () => ({ usable: false, providerSymbol: null, status: "ambiguous", refusal: "ambiguous_broker_symbols", detail: "ambiguous" }) as never },
      "ambiguous_broker_symbols",
    ],
    [
      "quote_and_spec",
      { fetchQuoteFor: async () => ({ bid: 1, ask: 1.0001, sourceTime: new Date(NOW - 10 * 60_000).toISOString(), receivedAt: "" }) },
      "stale",
    ],
    ["margin", { estimateMargin: async () => { throw new Error("bad"); } }, "margin calculation failed"],
  ];
  for (const [gate, over, reason] of cases) {
    it(`[UNIT] stops at ${gate}`, async () => {
      const { db } = fakeDb();
      const r = await runRuntimeValidation(db, input, deps(over));
      const idx = r.gates.findIndex((g) => g.status === "FAIL");
      expect(r.gates[idx]!.gate).toBe(gate);
      expect(r.gates[idx]!.reason).toContain(reason);
      expect(r.gates.slice(idx + 1).every((g) => g.status === "NOT_REACHED")).toBe(true);
      expect(r.passed).toBe(false);
    });
  }

  it("[UNIT] stops at reconciliation on an open critical discrepancy", async () => {
    const { db } = fakeDb({ discrepancies: [{ severity: "critical" }] });
    const r = await runRuntimeValidation(db, input, deps());
    expect(r.gates.at(-1)).toMatchObject({ gate: "reconciliation", status: "FAIL" });
  });
});
