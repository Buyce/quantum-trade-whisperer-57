/**
 * Automatic broker orders must obey the owner's own rules.
 *
 * These tests pin the contract that a published setup only becomes a delivery
 * for an armed account when that account's owner would also have been alerted
 * about it: instrument, session, grade threshold and daily cap.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";
import { enqueueDirectDeliveries } from "../direct-enqueue.server";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");

const ACCOUNT = {
  id: "acc-1",
  user_id: "user-1",
  mode: "demo_auto",
  broker_account_type: "demo",
};

interface Overrides {
  controls?: Record<string, unknown>;
  accounts?: Record<string, unknown>[];
  settings?: Record<string, unknown>;
  frame?: Record<string, unknown>[];
}

function fake(overrides: Overrides = {}) {
  const settings = {
    user_id: "user-1",
    instruments: ["XAUUSD"],
    sessions: ["london"],
    alert_min_grade: "B",
    daily_setup_cap: 0,
    execution_config_version: 7,
    ...(overrides.settings ?? {}),
  };
  return createFakeSupabase((call: FakeCall) => {
    if (call.table === "execution_controls") {
      return {
        data: [overrides.controls ?? { demo_auto_enabled: true, live_auto_enabled: false }],
        error: null,
      };
    }
    if (call.table === "connected_trading_accounts") {
      return { data: overrides.accounts ?? [ACCOUNT], error: null };
    }
    if (call.table === "scanner_settings") return { data: [settings], error: null };
    if (call.table === "scanned_signals") return { data: overrides.frame ?? [], error: null };
    return { data: [], error: null };
  });
}

const SIGNAL = {
  id: "sig-1",
  instrument: "XAUUSD",
  grade: "A",
  session: "london",
  detectedAt: new Date(NOW).toISOString(),
};

function inserts(calls: FakeCall[]) {
  return calls.filter((c) => c.table === "execution_deliveries" && c.op === "insert");
}

describe("enqueueDirectDeliveries", () => {
  it("[INVARIANT] enqueues one delivery for an armed account whose rules accept the setup", async () => {
    const f = fake();
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out).toMatchObject({ enqueued: 1, filtered: 0, reason: null });
    const rows = inserts(f.calls)[0]?.payload as unknown as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      user_id: "user-1",
      signal_id: "sig-1",
      bridge_profile: "metaapi_direct:acc-1",
      destination_type: "metaapi_direct",
      connected_account_id: "acc-1",
      dry_run: false,
      execution_config_version: 7,
    });
  });

  it("[INVARIANT] never enqueues a C-Grade setup without the owner's opt-in", async () => {
    const f = fake();
    const out = await enqueueDirectDeliveries(
      f.client as SupabaseClient,
      { ...SIGNAL, grade: "C" },
      NOW,
    );
    expect(out.enqueued).toBe(0);
    expect(out.reason).toBe("filtered_by_user_rules");
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it("[INVARIANT] enqueues a C-Grade setup only when the owner opted in and the tier allows C", async () => {
    const f = fake({ settings: { auto_execute_c_grade: true, alert_min_grade: "C" } });
    const out = await enqueueDirectDeliveries(
      f.client as SupabaseClient,
      { ...SIGNAL, grade: "C" },
      NOW,
    );
    expect(out.enqueued).toBe(1);
    expect(out.reason).toBeNull();
  });

  it("[INVARIANT] the C-Grade opt-in does not bypass the owner's alert tier", async () => {
    const f = fake({ settings: { auto_execute_c_grade: true, alert_min_grade: "B" } });
    const out = await enqueueDirectDeliveries(
      f.client as SupabaseClient,
      { ...SIGNAL, grade: "C" },
      NOW,
    );
    expect(out.enqueued).toBe(0);
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it("[INVARIANT] refuses when the system-wide automatic switches are off", async () => {
    const f = fake({ controls: { demo_auto_enabled: false, live_auto_enabled: false } });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.reason).toBe("automatic_execution_disabled");
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it("[INVARIANT] refuses when no account is armed", async () => {
    const f = fake({ accounts: [] });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.reason).toBe("no_armed_account");
  });

  it("[INVARIANT] filters an instrument the owner did not select", async () => {
    const f = fake({ settings: { instruments: ["EURUSD"] } });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out).toMatchObject({ enqueued: 0, filtered: 1, reason: "filtered_by_user_rules" });
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it("[INVARIANT] filters a session the owner did not select", async () => {
    const f = fake({ settings: { sessions: ["tokyo"] } });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.filtered).toBe(1);
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it("[INVARIANT] filters a grade below the owner's alert threshold", async () => {
    const f = fake({ settings: { alert_min_grade: "A+" } });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.filtered).toBe(1);
  });

  it("[INVARIANT] applies the owner's daily cap using the whole UTC-day frame", async () => {
    // Two earlier eligible A-Grade setups already consumed a cap of 2.
    const frame = [
      {
        id: "earlier-1",
        detected_at: new Date(NOW - 3_600_000).toISOString(),
        instrument: "XAUUSD",
        grade: "A",
        market_context: { trading_session: "london" },
      },
      {
        id: "earlier-2",
        detected_at: new Date(NOW - 1_800_000).toISOString(),
        instrument: "XAUUSD",
        grade: "A",
        market_context: { trading_session: "london" },
      },
    ];
    const f = fake({ settings: { daily_setup_cap: 2 }, frame });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out).toMatchObject({ enqueued: 0, filtered: 1 });

    // Cap 0 means unlimited: the same frame enqueues.
    const unlimited = fake({ settings: { daily_setup_cap: 0 }, frame });
    const out2 = await enqueueDirectDeliveries(unlimited.client as SupabaseClient, SIGNAL, NOW);
    expect(out2.enqueued).toBe(1);
  });

  it("[INVARIANT] does not guess when the owner has no settings row", async () => {
    const f = createFakeSupabase((call: FakeCall) => {
      if (call.table === "execution_controls") {
        return { data: [{ demo_auto_enabled: true, live_auto_enabled: false }], error: null };
      }
      if (call.table === "connected_trading_accounts") return { data: [ACCOUNT], error: null };
      return { data: [], error: null };
    });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out).toMatchObject({ enqueued: 0, filtered: 1 });
  });

  it("[INVARIANT] does not enqueue a live-auto account while live auto is off", async () => {
    const f = fake({
      accounts: [{ ...ACCOUNT, mode: "live_auto", broker_account_type: "real" }],
    });
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.reason).toBe("no_armed_account");
  });
  it.each(["A+", "A", "B", "C"])(
    "[INVARIANT] records a decision for a %s-Grade attempt even when the check itself throws",
    async (grade) => {
      const recorded: FakeCall[] = [];
      const f = createFakeSupabase((call: FakeCall) => {
        if (call.table === "execution_enqueue_decisions") {
          recorded.push(call);
          return { data: [], error: null };
        }
        if (call.table === "execution_controls") {
          // Any throw inside the attempt: a transport failure on a gate read.
          throw new Error("control read unavailable");
        }
        return { data: [], error: null };
      });
      const out = await enqueueDirectDeliveries(
        f.client as SupabaseClient,
        { ...SIGNAL, grade },
        NOW,
      );
      expect(out.enqueued).toBe(0);
      expect(out.reason).toContain("enqueue_attempt_failed");
      const rows = recorded[0]?.payload as unknown as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        signal_id: "sig-1",
        grade,
        decision: "enqueue_attempt_failed",
        enqueued: 0,
      });
      expect(String(rows[0]?.["detail"])).toContain("control read unavailable");
    },
  );
});
