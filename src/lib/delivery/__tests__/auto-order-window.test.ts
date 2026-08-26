/**
 * The automatic-order window is a per-owner setting (0-360 minutes, default 180).
 * These tests pin its boundaries and, critically, that it is SEPARATE from the
 * structural 30-minute time-in-force that replay, shadow and research use — a
 * user widening their window must never move research mathematics.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTO_ORDER_WINDOW_DEFAULT_MINUTES,
  AUTO_ORDER_WINDOW_MAX_MINUTES,
  ORDER_TIF_MINUTES,
  clampAutoOrderWindowMinutes,
} from "@/lib/db-types";
import { orderExpiry } from "@/lib/execution/direct";
import {
  executionWindowExpired,
  enqueueDirectDeliveries,
} from "@/lib/delivery/direct-enqueue.server";
import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";

describe("automatic-order window bounds", () => {
  it("[UNIT] defaults to 3 hours and never exceeds 6 hours", () => {
    expect(AUTO_ORDER_WINDOW_DEFAULT_MINUTES).toBe(180);
    expect(AUTO_ORDER_WINDOW_MAX_MINUTES).toBe(360);
    expect(clampAutoOrderWindowMinutes(null)).toBe(180);
    expect(clampAutoOrderWindowMinutes(undefined)).toBe(180);
    expect(clampAutoOrderWindowMinutes(Number.NaN)).toBe(180);
    expect(clampAutoOrderWindowMinutes(-5)).toBe(0);
    expect(clampAutoOrderWindowMinutes(1000)).toBe(360);
    expect(clampAutoOrderWindowMinutes(90.6)).toBe(91);
  });

  it("[INVARIANT] is independent of the structural time-in-force", () => {
    expect(ORDER_TIF_MINUTES).toBe(30);
  });

  it("[UNIT] the shared pre-settings check only prunes past the widest window", () => {
    const now = Date.parse("2026-08-26T12:00:00.000Z");
    const at = (iso: string) => ({ detectedAt: iso });
    expect(executionWindowExpired(at("2026-08-26T08:00:00.000Z"), now)).toBe(false);
    expect(executionWindowExpired(at("2026-08-26T05:00:00.000Z"), now)).toBe(true);
    // The owner's own window refuses earlier.
    expect(executionWindowExpired(at("2026-08-26T08:00:00.000Z"), now, 60)).toBe(true);
  });

  it("[UNIT] a pending order expires at the end of the owner's window", () => {
    const detected = "2026-08-26T12:00:00.000Z";
    expect(orderExpiry(detected, 180)).toBe("2026-08-26T15:00:00.000Z");
    // Absent a window, the structural default is used.
    expect(orderExpiry(detected)).toBe("2026-08-26T12:30:00.000Z");
    expect(() => orderExpiry(detected, 0)).toThrow();
  });
});

describe("per-owner window in the enqueue path", () => {
  const NOW = Date.parse("2026-08-26T12:00:00.000Z");
  const SIGNAL = {
    id: "sig-1",
    instrument: "EURUSD",
    grade: "B" as const,
    direction: "long",
    // 100 minutes old: outside the structural 30-minute TIF, inside a 3-hour window.
    detectedAt: "2026-08-26T10:20:00.000Z",
    tradingSession: "london",
  };

  function fake(windowMinutes: number | null) {
    return createFakeSupabase((call: FakeCall) => {
      if (call.table === "execution_controls") {
        return {
          data: [
            { key: "demo_auto_enabled", value: true },
            { key: "live_execution_enabled", value: false },
            { key: "force_dry_run", value: false },
          ],
          error: null,
        };
      }
      if (call.table === "connected_trading_accounts") {
        return {
          data: [{ id: "acc-1", user_id: "user-1", mode: "demo" }],
          error: null,
        };
      }
      if (call.table === "scanner_settings") {
        return {
          data: [
            {
              user_id: "user-1",
              instruments: ["EURUSD"],
              sessions: ["london"],
              alert_min_grade: "B",
              daily_setup_cap: 0,
              execution_config_version: 1,
              auto_intel_gate_enabled: false,
              auto_intel_min_win_pct: null,
              auto_intel_min_sample: 30,
              auto_execute_c_grade: false,
              maximum_active_signal_orders: 3,
              auto_order_window_minutes: windowMinutes,
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
  }

  it("[INVARIANT] a window of 0 refuses every automatic order on age grounds", async () => {
    const f = fake(0);
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.enqueued).toBe(0);
    const decisions = f.calls
      .filter((c) => c.table === "execution_enqueue_decisions" && c.op === "insert")
      .flatMap((c) => c.payload as unknown as Record<string, unknown>[]);
    expect(decisions.some((d) => d["decision"] === "execution_window_expired")).toBe(true);
  });

  it("[INVARIANT] a narrower owner window refuses a setup the widest window allows", async () => {
    const f = fake(60);
    const out = await enqueueDirectDeliveries(f.client as SupabaseClient, SIGNAL, NOW);
    expect(out.enqueued).toBe(0);
    const decisions = f.calls
      .filter((c) => c.table === "execution_enqueue_decisions" && c.op === "insert")
      .flatMap((c) => c.payload as unknown as Record<string, unknown>[]);
    expect(decisions.some((d) => d["decision"] === "execution_window_expired")).toBe(true);
  });
});
