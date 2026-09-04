/**
 * News gate at the execution boundaries.
 *
 * These tests pin the two things the gate must never do: refuse an order out of
 * missing data alone, and enforce a window the owner did not ask for.
 */
import { describe, expect, it } from "vitest";

import { evaluateNewsGate } from "../gate.server";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

interface Rows {
  coverage: Record<string, unknown>[];
  events: Record<string, unknown>[];
}

/** Minimal query stub: only the chain shapes the gate actually uses. */
function fakeDb(rows: Rows) {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const builder = (data: Record<string, unknown>[]) => {
    const chain: Record<string, unknown> = {};
    for (const key of ["select", "in", "or", "order"]) {
      chain[key] = () => chain;
    }
    chain["limit"] = () => Promise.resolve({ data });
    return chain;
  };
  return {
    inserted,
    from(table: string) {
      if (table === "news_coverage_snapshots") return builder(rows.coverage);
      if (table === "economic_events") return builder(rows.events);
      return {
        insert(row: Record<string, unknown>) {
          (inserted[table] ??= []).push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

const HEALTHY_USD = ["central_bank", "inflation", "employment"].map((family) => ({
  currency: "USD",
  event_family: family,
  coverage_state: "healthy",
  computed_at: "2026-09-04T11:00:00.000Z",
}));

const CPI_NOW = {
  id: "11111111-1111-1111-1111-111111111111",
  canonical_event_id: "usd:cpi:2026-08",
  event_family: "inflation",
  currencies: ["USD"],
  affected_instruments: ["XAUUSD"],
  importance: "high",
  scheduled_at: "2026-09-04T12:30:00.000Z",
  scheduled_date: "2026-09-04",
  timestamp_precision: "exact",
  event_status: "scheduled",
};

describe("news gate", () => {
  it("[UNIT] refuses a new order inside a high-impact window when the owner opted in", async () => {
    const db = fakeDb({ coverage: HEALTHY_USD, events: [CPI_NOW] });
    const result = await evaluateNewsGate(db as never, {
      symbol: "XAUUSD",
      nowMs: NOW,
      boundary: "execution_enqueue",
      settings: { news_block_new_entries: true },
    });
    expect(result.blocked).toBe(true);
    expect(result.verdict.reason).toBe("event_window");
    expect(db.inserted["news_policy_evaluations"]?.[0]?.["decision"]).toBe("suppressed");
  });

  it("[UNIT] records but does not enforce when the owner switched news blocking off", async () => {
    const db = fakeDb({ coverage: HEALTHY_USD, events: [CPI_NOW] });
    const result = await evaluateNewsGate(db as never, {
      symbol: "XAUUSD",
      nowMs: NOW,
      boundary: "execution_enqueue",
      settings: { news_block_new_entries: false },
    });
    expect(result.blocked).toBe(false);
    expect(result.verdict.wouldSuppressNewEntries).toBe(true);
    expect(db.inserted["news_policy_evaluations"]?.[0]?.["decision"]).toBe("would_suppress");
  });

  it("[INVARIANT] never refuses on incomplete coverage alone", async () => {
    const db = fakeDb({ coverage: [], events: [] });
    const result = await evaluateNewsGate(db as never, {
      symbol: "XAUUSD",
      nowMs: NOW,
      boundary: "execution_enqueue",
      settings: { news_block_new_entries: true },
    });
    expect(result.verdict.wouldSuppressNewEntries).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.detail).toContain("not enforced");
  });

  it("[UNIT] honours the owner's own window width", async () => {
    const db = fakeDb({ coverage: HEALTHY_USD, events: [CPI_NOW] });
    // 30 minutes before the release is 12:00, so a 15-minute window is clear.
    const result = await evaluateNewsGate(db as never, {
      symbol: "XAUUSD",
      nowMs: NOW,
      boundary: "execution_enqueue",
      settings: {
        news_block_new_entries: true,
        news_suppression_minutes_before: 15,
        news_suppression_minutes_after: 15,
      },
    });
    expect(result.blocked).toBe(false);
    expect(result.verdict.reason).toBe("clear");
  });
});
