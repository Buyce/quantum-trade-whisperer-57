import { describe, expect, it } from "vitest";
import { runGetPlatformBenchmarks } from "../tools/get-platform-benchmarks";

describe("platform benchmark provenance", () => {
  it("[INVARIANT] journal-sourced totals are labelled self-reported, not broker verified", async () => {
    const block = { trades: 12, win_rate: 50, avg_r: 0.1 };
    const db = { rpc: async () => ({ data: { broker_verified_trades: block }, error: null }) };
    const out = (await runGetPlatformBenchmarks(db)) as { structuredContent: Record<string, unknown> };
    expect(out.structuredContent.journal_trades).toEqual(block);
    expect(String(out.structuredContent.trades_provenance)).toMatch(/self-reported/);
    expect(String(out.structuredContent.trades_provenance)).toMatch(/NOT broker verified/);
  });
});
