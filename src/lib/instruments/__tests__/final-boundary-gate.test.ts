/**
 * The LAST-MOMENT lifecycle gate (Phase A2A, R3-FIX / R6-FIX).
 *
 * Every irreversible act — a broker submission, an alert fan-out, an immutable
 * research row — re-reads the stage instead of trusting the view taken at the top
 * of the worker pass. These tests pin the two properties that make that re-read
 * worth its round trip:
 *
 *   - a stage read that FAILS refuses everything outside the frozen Wave 0
 *     universe, rather than degrading to "allowed";
 *   - a suspension that lands between planning and the boundary is honoured.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertCapability } from "../lifecycle.server";

type StageRow = { symbol: string; stage: string };

/** Minimal stand-in for the two reads `readLifecycleView` performs. */
function fakeDb(args: { enforced: boolean | null; stages: StageRow[] | null }) {
  return {
    from(table: string) {
      if (table === "execution_controls") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                args.enforced === null
                  ? { data: null, error: { message: "unreadable" } }
                  : { data: { lifecycle_enforced: args.enforced }, error: null },
            }),
          }),
        };
      }
      return {
        select: async () =>
          args.stages === null
            ? { data: null, error: { message: "unreadable" } }
            : { data: args.stages, error: null },
      };
    },
  } as unknown as SupabaseClient;
}

describe("last-moment lifecycle gate", () => {
  it("[INVARIANT] refuses execution for a Wave 1 symbol when the stage cannot be read", async () => {
    const gate = await assertCapability(fakeDb({ enforced: true, stages: null }), "USDJPY", "execute");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("USDJPY");
  });

  it("[INVARIANT] an unreadable stage still lets the frozen Wave 0 universe trade", async () => {
    const gate = await assertCapability(fakeDb({ enforced: null, stages: null }), "EURUSD", "execute");
    expect(gate.allowed).toBe(true);
  });

  it("[INVARIANT] a suspension decided after planning is honoured at the boundary", async () => {
    const db = fakeDb({ enforced: true, stages: [{ symbol: "EURUSD", stage: "suspended" }] });
    expect((await assertCapability(db, "EURUSD", "execute")).allowed).toBe(false);
    expect((await assertCapability(db, "EURUSD", "alert")).allowed).toBe(false);
    expect((await assertCapability(db, "EURUSD", "resolve_research")).allowed).toBe(false);
    expect((await assertCapability(db, "EURUSD", "collect_data")).allowed).toBe(false);
  });

  it("[INVARIANT] signals_only publishes and alerts but never reaches a broker", async () => {
    const db = fakeDb({ enforced: true, stages: [{ symbol: "USDJPY", stage: "signals_only" }] });
    expect((await assertCapability(db, "USDJPY", "publish")).allowed).toBe(true);
    expect((await assertCapability(db, "USDJPY", "alert")).allowed).toBe(true);
    expect((await assertCapability(db, "USDJPY", "execute")).allowed).toBe(false);
  });

  it("[INVARIANT] data_validation may fetch candles but writes no research", async () => {
    const db = fakeDb({ enforced: true, stages: [{ symbol: "USDCHF", stage: "data_validation" }] });
    expect((await assertCapability(db, "USDCHF", "collect_data")).allowed).toBe(true);
    expect((await assertCapability(db, "USDCHF", "resolve_research")).allowed).toBe(false);
    expect((await assertCapability(db, "USDCHF", "capture_research")).allowed).toBe(false);
  });
});
