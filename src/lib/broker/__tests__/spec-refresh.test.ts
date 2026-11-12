/**
 * Prompt 12 completion patch — durable specification attempt budget.
 *
 * These are integration tests over the real refresher against a recording fake
 * database: they assert what the module ASKS the broker and the database for, so
 * a regression that reintroduces per-cycle broker requests fails here.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/test/fakes/supabase";

const fetchSymbolSpecification = vi.fn();

vi.mock("@/lib/scanner/metaapi.server", () => ({
  fetchSymbolSpecification: (symbol: string) => fetchSymbolSpecification(symbol),
  fetchQuote: vi.fn(),
}));

import { refreshSymbolSpecs, SPEC_REFRESH_MS } from "../specs.server";

beforeEach(() => {
  fetchSymbolSpecification.mockReset();
});

describe("spec refresh budget", () => {
  it("[INVARIANT] issues zero broker requests when the durable budget is spent", async () => {
    // claim_spec_refresh returns false: the row was attempted inside the window.
    const fake = createFakeSupabase(
      () => ({ data: [], error: null }),
      () => ({ data: false, error: null }),
    );
    const outcomes = await refreshSymbolSpecs(
      fake.client as Parameters<typeof refreshSymbolSpecs>[0],
      Date.now(),
      ["XAUUSD"],
    );
    expect(fetchSymbolSpecification).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ symbol: "XAUUSD", action: "budget_exhausted" });
    expect(fake.rpcCalls[0]?.fn).toBe("claim_spec_refresh");
    expect(fake.rpcCalls[0]?.args).toMatchObject({
      _min_interval_seconds: Math.floor(SPEC_REFRESH_MS / 1000),
    });
  });

  it("[INVARIANT] spends the budget before the broker call, so a broker failure cannot retry", async () => {
    fetchSymbolSpecification.mockRejectedValue(new Error("broker 500"));
    const fake = createFakeSupabase(
      () => ({ data: [], error: null }),
      (fn) => ({ data: fn === "claim_spec_refresh" ? true : null, error: null }),
    );
    const outcomes = await refreshSymbolSpecs(
      fake.client as Parameters<typeof refreshSymbolSpecs>[0],
      Date.now(),
      ["XAUUSD"],
    );
    // The claim happened first and is durable; only one broker attempt was made.
    expect(fake.rpcCalls[0]?.fn).toBe("claim_spec_refresh");
    expect(fetchSymbolSpecification).toHaveBeenCalledTimes(1);
    expect(outcomes[0]?.action).toBe("failed");
    expect(fake.rpcCalls.some((c) => c.fn === "record_spec_refresh_outcome")).toBe(true);
  });

  it("[INVARIANT] a database write outage does not produce a second broker request", async () => {
    fetchSymbolSpecification.mockResolvedValue({ contractSize: 100, volumeStep: 0.01, digits: 2 });
    const fake = createFakeSupabase(
      (call) =>
        call.op === "insert"
          ? { data: null, error: { message: "db down" } }
          : { data: [], error: null },
      (fn) => ({ data: fn === "claim_spec_refresh" ? true : null, error: null }),
    );
    const outcomes = await refreshSymbolSpecs(
      fake.client as Parameters<typeof refreshSymbolSpecs>[0],
      Date.now(),
      ["XAUUSD"],
    );
    expect(fetchSymbolSpecification).toHaveBeenCalledTimes(1);
    expect(outcomes[0]).toMatchObject({ action: "failed" });
  });

  it("[INVARIANT] refuses to call the broker when the claim itself is unavailable", async () => {
    const fake = createFakeSupabase(
      () => ({ data: [], error: null }),
      () => ({ data: null, error: { message: "rpc unavailable" } }),
    );
    const outcomes = await refreshSymbolSpecs(
      fake.client as Parameters<typeof refreshSymbolSpecs>[0],
      Date.now(),
      ["XAUUSD"],
    );
    expect(fetchSymbolSpecification).not.toHaveBeenCalled();
    expect(outcomes[0]?.action).toBe("claim_unavailable");
  });

  it("[INVARIANT] re-verifies an instrument outside Wave 0 so its stale broker name can clear", async () => {
    fetchSymbolSpecification.mockResolvedValue({ contractSize: 100, volumeStep: 0.01, digits: 2 });
    const fake = createFakeSupabase(
      () => ({ data: [], error: null }),
      (fn) => ({ data: fn === "claim_spec_refresh" ? true : null, error: null }),
    );
    const outcomes = await refreshSymbolSpecs(
      fake.client as Parameters<typeof refreshSymbolSpecs>[0],
      Date.now(),
      ["GBPUSD"],
    );
    expect(fetchSymbolSpecification).toHaveBeenCalledTimes(1);
    expect(outcomes[0]).toMatchObject({ symbol: "GBPUSD", action: "refreshed" });
    const written = fake.calls.find((c) => c.table === "broker_symbol_specs");
    expect(written?.payload).toMatchObject({ symbol: "GBPUSD" });
  });
});

describe("cron separation", () => {
  it("[INVARIANT] the 15-minute scan cron performs no specification refresh", () => {
    const src = readFileSync("src/routes/api/public/cron/scan.ts", "utf8");
    expect(src).not.toMatch(/refreshSymbolSpecs/);
    expect(src).not.toMatch(/specs\.server/);
  });

  it("[INVARIANT] the refresh lives on its own authenticated cron route", () => {
    const src = readFileSync("src/routes/api/public/cron/refresh-specs.ts", "utf8");
    expect(src).toMatch(/authorizeCronRequest/);
    expect(src).toMatch(/refreshSymbolSpecs/);
  });

  it("[INVARIANT] the refresh cron re-verifies the scanned universe, not just Wave 0", () => {
    const src = readFileSync("src/routes/api/public/cron/refresh-specs.ts", "utf8");
    // The list must come from the lifecycle-driven scan universe...
    expect(src).toMatch(/scanUniverse/);
    // ...and be passed through, so the refresher cannot silently fall back to
    // its Wave 0 default and leave Wave 1+ names permanently stale.
    expect(src).toMatch(/refreshSymbolSpecs\(db, Date\.now\(\), symbols\)/);
  });
});
