/**
 * The concurrent-order ceiling counts ORDERS, not diagnostics.
 *
 * A dry-run delivery is validated and signed but never reaches a broker, so it
 * holds no order. Counting one would let an outbound webhook dry-run silently
 * spend the owner's ceiling and block a real demo order — the exact failure this
 * covers.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { occupiedOrderCounts } from "../direct-enqueue.server";

interface Row {
  user_id: string;
  state: string;
  enqueued_at: string;
  dry_run: boolean;
  submitted_at?: string | null;
  client_id?: string | null;
  broker_order_id?: string | null;
}

const NOW = Date.parse("2026-08-25T19:00:00.000Z");

function client(rows: Row[]) {
  const filters: { op: string; column: string; value: unknown }[] = [];
  const builder: Record<string, unknown> = {};
  const chain = (op: string) => (column: string, value: unknown) => {
    filters.push({ op, column, value });
    return builder;
  };
  builder["select"] = () => builder;
  builder["in"] = chain("in");
  builder["neq"] = chain("neq");
  builder["gte"] = chain("gte");
  builder["then"] = (resolve: (v: unknown) => unknown) => {
    const dryRunExcluded = filters.some((f) => f.op === "neq" && f.column === "dry_run");
    const data = dryRunExcluded ? rows.filter((r) => r.dry_run !== true) : rows;
    return Promise.resolve(resolve({ data, error: null }));
  };
  return {
    client: { from: () => builder } as unknown as SupabaseClient,
    filters,
  };
}

describe("occupiedOrderCounts", () => {
  it("[INVARIANT] a dry-run delivery never spends the ceiling", async () => {
    const c = client([
      { user_id: "u1", state: "acknowledged", enqueued_at: "2026-08-25T18:00:00Z", dry_run: true },
      { user_id: "u1", state: "acknowledged", enqueued_at: "2026-08-25T18:30:00Z", dry_run: true },
      { user_id: "u1", state: "pending", enqueued_at: "2026-08-25T18:40:00Z", dry_run: false, submitted_at: "2026-08-25T18:45:00Z", client_id: "PT-1", broker_order_id: "9" },
    ]);
    const out = await occupiedOrderCounts(c.client, ["u1"], NOW);
    expect(out.readable).toBe(true);
    expect(out.counts.get("u1")).toBe(1);
    expect(
      c.filters.some((f) => f.op === "neq" && f.column === "dry_run" && f.value === true),
    ).toBe(true);
  });

  it("[INVARIANT] real occupying orders are still counted", async () => {
    const c = client([
      { user_id: "u1", state: "sent", enqueued_at: "2026-08-25T18:00:00Z", dry_run: false, submitted_at: "2026-08-25T18:45:00Z", client_id: "PT-1", broker_order_id: "9" },
      { user_id: "u1", state: "acknowledged", enqueued_at: "2026-08-25T18:10:00Z", dry_run: false, submitted_at: "2026-08-25T18:45:00Z", client_id: "PT-1", broker_order_id: "9" },
      { user_id: "u2", state: "pending", enqueued_at: "2026-08-25T18:20:00Z", dry_run: false, submitted_at: "2026-08-25T18:45:00Z", client_id: "PT-1", broker_order_id: "9" },
    ]);
    const out = await occupiedOrderCounts(c.client, ["u1", "u2"], NOW);
    expect(out.counts.get("u1")).toBe(2);
    expect(out.counts.get("u2")).toBe(1);
  });

  it("[INVARIANT] an attempt that provably never reached a broker holds no slot", async () => {
    const c = client([
      {
        user_id: "u1",
        state: "unknown",
        enqueued_at: "2026-08-25T18:00:00Z",
        dry_run: false,
        submitted_at: null,
        client_id: null,
        broker_order_id: null,
      },
      {
        user_id: "u1",
        state: "unknown",
        enqueued_at: "2026-08-25T18:10:00Z",
        dry_run: false,
        submitted_at: null,
        client_id: "PT-2",
        broker_order_id: null,
      },
    ]);
    const out = await occupiedOrderCounts(c.client, ["u1"], NOW);
    // Only the ambiguous one (the broker saw a clientId) keeps its slot.
    expect(out.counts.get("u1")).toBe(1);
  });
});
