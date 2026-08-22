/**
 * Prompt 12 completion patch — the shared sizing service.
 *
 * Integration tests over the real entry point both the terminal and MCP use,
 * with a recording fake database and a stubbed broker. They prove: broker specs
 * are loaded, model 2 runs as shadow only, model 1 stays authoritative, a real
 * divergence is recorded, a stale required quote refuses to size, and a partial
 * broker row cannot acquire broker provenance.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";

const fetchQuote = vi.fn();
const adminInserts: { table: string; row: Record<string, unknown> }[] = [];
let v2Enabled = false;

vi.mock("@/lib/scanner/metaapi.server", () => ({
  fetchQuote: (symbol: string) => fetchQuote(symbol),
  fetchSymbolSpecification: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      return {
        select: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { sizing_v2_enabled: v2Enabled }, error: null }),
        }),
        insert: (row: Record<string, unknown>) => {
          adminInserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  },
}));

import { resolveSizingForUser } from "../service.server";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

const settingsRow = {
  account_equity: 10_000,
  account_currency: "USD",
  risk_per_trade_percent: 1,
  max_position_size: 100,
  leverage: 100,
  max_stop_loss_percent: 5,
  equity_as_of: "2026-08-01T00:00:00.000Z",
};

function brokerRow(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "XAUUSD",
    contract_size: 100,
    tick_size: 0.01,
    tick_value: 1,
    volume_min: 0.01,
    volume_max: 100,
    volume_step: 0.01,
    volume_limit: null,
    stops_level: 0,
    freeze_level: 0,
    digits: 2,
    point: 0.01,
    point_source: "derived_from_digits",
    base_currency: "XAU",
    profit_currency: "USD",
    margin_currency: "USD",
    trade_mode: "SYMBOL_TRADE_MODE_FULL",
    calc_mode: "SYMBOL_CALC_MODE_CFDLEVERAGE",
    fetched_at: new Date(NOW - 3600_000).toISOString(),
    ...overrides,
  };
}

function db(spec: Record<string, unknown> | null, trades: unknown[] = []) {
  const handler = (call: FakeCall) => {
    if (call.table === "scanner_settings") return { data: [settingsRow], error: null };
    if (call.table === "broker_symbol_specs") return { data: spec ? [spec] : [], error: null };
    if (call.table === "executed_trades") return { data: trades, error: null };
    return { data: [], error: null };
  };
  return createFakeSupabase(handler);
}

const setup = { instrument: "XAUUSD", entryPrice: 2400, stopLoss: 2390, finalTargetR: 2 };

beforeEach(() => {
  adminInserts.length = 0;
  fetchQuote.mockReset();
  v2Enabled = false;
});

describe("shared sizing service", () => {
  it("[INVARIANT] loads the broker spec, runs V2 as shadow and returns V1 as authoritative", async () => {
    const fake = db(brokerRow({ volume_max: 0.05 }));
    const result = await resolveSizingForUser(
      fake.client as Parameters<typeof resolveSizingForUser>[0],
      "user-1",
      setup,
      NOW,
    );
    expect(fake.calls.some((c) => c.table === "broker_symbol_specs")).toBe(true);
    expect(result.available).toBe(true);
    expect(result.provenance.authoritativeModel).toBe(1);
    expect(result.provenance.shadowAvailable).toBe(true);
    expect(result.provenance.specSource).toBe("static_v1");
    if (result.available) {
      // V1 sizing is unaffected by the broker's tighter volume ceiling.
      expect(result.lots).toBeCloseTo(0.1, 5);
      expect(result.cappedByBrokerVolume).toBe(false);
    }
  });

  it("[INVARIANT] records a divergence row when the shadow model would differ", async () => {
    const fake = db(brokerRow({ volume_max: 0.05 }));
    await resolveSizingForUser(
      fake.client as Parameters<typeof resolveSizingForUser>[0],
      "user-1",
      setup,
      NOW,
    );
    const logged = adminInserts.filter((i) => i.table === "sizing_divergence_log");
    expect(logged).toHaveLength(1);
    expect(logged[0]?.row).toMatchObject({ authoritative_model: 1, v1_lots: 0.1, v2_lots: 0.05 });
  });

  it("[INVARIANT] refuses to size when the required conversion quote is stale", async () => {
    // GBPAUD risk lands in AUD, so a USD account needs an AUDUSD leg.
    fetchQuote.mockResolvedValue({
      bid: 0.66,
      ask: 0.661,
      sourceTime: new Date(NOW - 10 * 60_000).toISOString(),
    });
    const fake = db(null);
    const result = await resolveSizingForUser(
      fake.client as Parameters<typeof resolveSizingForUser>[0],
      "user-1",
      { instrument: "GBPAUD", entryPrice: 1.95, stopLoss: 1.94, finalTargetR: 2 },
      NOW,
    );
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe("stale_quote");
    expect(result.provenance.quoteStale).toBe(true);
  });

  it("[INVARIANT] a stale quote leaves authoritative provenance on the static model", async () => {
    // Broker spec exists (shadow available) but model 1 is authoritative, so
    // authoritative provenance must stay static_v1 even on an unavailable result.
    fetchQuote.mockResolvedValue({
      bid: 0.66,
      ask: 0.661,
      sourceTime: new Date(NOW - 10 * 60_000).toISOString(),
    });
    const fake = db(brokerRow({ symbol: "GBPAUD" }));
    const result = await resolveSizingForUser(
      fake.client as Parameters<typeof resolveSizingForUser>[0],
      "user-1",
      { instrument: "GBPAUD", entryPrice: 1.95, stopLoss: 1.94, finalTargetR: 2 },
      NOW,
    );
    expect(result.available).toBe(false);
    expect(result.provenance.authoritativeModel).toBe(1);
    expect(result.provenance.specSource).toBe("static_v1");
    expect(result.provenance.specAsOf).toBeNull();
    expect(result.provenance.shadowSpecSource).toBe("broker");
  });

  it("[UNIT] issues zero conversion requests when the currencies already match", async () => {
    const fake = db(brokerRow());
    const result = await resolveSizingForUser(
      fake.client as Parameters<typeof resolveSizingForUser>[0],
      "user-1",
      setup,
      NOW,
    );
    expect(fetchQuote).not.toHaveBeenCalled();
    expect(result.provenance.conversionRequests).toBe(0);
    expect(result.provenance.conversionRoute).toBe("parity");
  });

  it("[INVARIANT] a partial broker row cannot acquire broker provenance", async () => {
    // No contract size: the row is unusable, so no shadow model exists at all.
    const fake = db(brokerRow({ contract_size: null }));
    const result = await resolveSizingForUser(
      fake.client as Parameters<typeof resolveSizingForUser>[0],
      "user-1",
      setup,
      NOW,
    );
    expect(result.provenance.shadowAvailable).toBe(false);
    expect(result.provenance.specSource).toBe("static_v1");
    expect(adminInserts.filter((i) => i.table === "sizing_divergence_log")).toHaveLength(0);
  });

  it("[INVARIANT] labels equity as user-entered and reports when it was entered", async () => {
    const fake = db(brokerRow());
    const result = await resolveSizingForUser(
      fake.client as Parameters<typeof resolveSizingForUser>[0],
      "user-1",
      setup,
      NOW,
    );
    expect(result.provenance.equityBasis).toBe("user_entered");
    expect(result.provenance.equityAsOf).toBe(settingsRow.equity_as_of);
  });

  it("[UNIT] advisory exposure is derived only from the user's own logged trades", async () => {
    const fake = db(brokerRow(), [
      { outcome: "open", actual_entry_at: new Date(NOW - 3600_000).toISOString(), signal_instrument: "XAUUSD" },
      { outcome: "open", actual_entry_at: null, signal_instrument: "EURUSD" },
      {
        outcome: "loss",
        actual_exit_at: new Date(NOW - 1800_000).toISOString(),
        r_vs_plan: -1,
        signal_instrument: "XAUUSD",
      },
    ]);
    const result = await resolveSizingForUser(
      fake.client as Parameters<typeof resolveSizingForUser>[0],
      "user-1",
      setup,
      NOW,
    );
    expect(result.advisory?.basis).toBe("trades you logged");
    expect(result.advisory?.openPositions).toBe(1);
    expect(result.advisory?.pendingPositions).toBe(1);
    expect(result.advisory?.realizedLossTodayR).toBe(1);
    expect(fake.calls.some((c) => c.table === "executed_trades" && c.eq["user_id"] === "user-1")).toBe(
      true,
    );
  });
});

describe("one sizing implementation", () => {
  it("[INVARIANT] the terminal card resolves sizing through the shared server service", () => {
    const src = readFileSync("src/components/SignalCard.tsx", "utf8");
    expect(src).toMatch(/resolveSizingForSetup/);
    expect(src).not.toMatch(/calculateRisk\(/);
  });

  it("[INVARIANT] MCP position sizing uses the same server service", () => {
    const src = readFileSync("src/lib/mcp/tools/calculate-position-size.ts", "utf8");
    expect(src).toMatch(/resolveSizingForUser/);
    expect(src).not.toMatch(/calculateRisk\(/);
  });

  it("[INVARIANT] the public quotes endpoint serves display prices only, no FX rate map", () => {
    const src = readFileSync("src/routes/api/public/quotes.ts", "utf8");
    // No conversion-rate payload: conversion legs are demand-driven inside the
    // authenticated sizing service, never fetched for every open terminal.
    expect(src).not.toMatch(/rates:/);
    expect(src).not.toMatch(/CONVERSION|resolveConversionRates/);
  });
});
