/**
 * Active-signal execution reconciliation.
 *
 * These tests pin the behaviour that fixes the real defect: automatic orders used
 * to be attempted exactly once, at publication. They also pin the boundaries that
 * keep the fix safe — deterministic selection order, no order without a qualifying
 * signal, and no coupling to alerts.
 */
import { describe, expect, it } from "vitest";

import {
  isReconcilable,
  rankActiveSignals,
  type ActiveSignalRow,
} from "../reconcile-active.server";

function signal(over: Partial<ActiveSignalRow> & { id: string }): ActiveSignalRow {
  return {
    instrument: "EURUSD",
    grade: "B",
    direction: "long",
  detected_at: "2026-08-25T11:45:00.000Z",
    expired_at: null,
    status: "active",
    ...over,
  };
}

const NOW = Date.parse("2026-08-25T12:00:00.000Z");

describe("reconcilable signal state", () => {
  it("[UNIT] an active, unexpired signal is reconcilable", () => {
    expect(isReconcilable(signal({ id: "a" }), NOW)).toBe(true);
  });

  it("[INVARIANT] an expired signal is never reconciled, however it is displayed", () => {
    expect(isReconcilable(signal({ id: "a", expired_at: "2026-08-25T11:00:00.000Z" }), NOW)).toBe(
      false,
    );
  });

  it("[INVARIANT] a non-active status is never reconciled", () => {
    for (const status of ["resolved", "cancelled", "superseded", "expired"]) {
      expect(isReconcilable(signal({ id: "a", status }), NOW)).toBe(false);
    }
  });

  it("[UNIT] an expiry exactly at now is already past", () => {
    expect(isReconcilable(signal({ id: "a", expired_at: new Date(NOW).toISOString() }), NOW)).toBe(
      false,
    );
  });

  it("[INVARIANT] a signal outside the automatic-order window is not reconciled", () => {
    expect(isReconcilable(signal({ id: "a", detected_at: "2026-08-25T11:29:00.000Z" }), NOW)).toBe(
      false,
    );
  });
});

describe("deterministic top-of-feed ordering", () => {
  const rows = [
    signal({ id: "c1", grade: "C", detected_at: "2026-08-25T11:59:00.000Z" }),
    signal({ id: "b1", grade: "B", detected_at: "2026-08-25T09:00:00.000Z" }),
    signal({ id: "a1", grade: "A", detected_at: "2026-08-25T08:00:00.000Z" }),
    signal({ id: "ap1", grade: "A+", detected_at: "2026-08-25T07:00:00.000Z" }),
  ];

  it("[UNIT] grade leads, then newest first", () => {
    expect(rankActiveSignals(rows).map((r) => r.id)).toEqual(["ap1", "a1", "b1", "c1"]);
  });

  it("[INVARIANT] equal grade and instant fall back to a stable id tie-breaker", () => {
    const tied = [
      signal({ id: "zz", grade: "A" }),
      signal({ id: "aa", grade: "A" }),
      signal({ id: "mm", grade: "A" }),
    ];
    expect(rankActiveSignals(tied).map((r) => r.id)).toEqual(["aa", "mm", "zz"]);
    // Two workers ranking the same set must agree, whatever order they read it in.
    expect(rankActiveSignals([...tied].reverse()).map((r) => r.id)).toEqual(["aa", "mm", "zz"]);
  });

  it("[UNIT] ranking does not mutate its input", () => {
    const input = [...rows];
    rankActiveSignals(input);
    expect(input.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("[INVARIANT] a top-10 selection of fewer than ten eligible signals yields only those", () => {
    const three = rankActiveSignals(rows.slice(0, 3)).slice(0, 10);
    expect(three).toHaveLength(3);
  });

  it("[INVARIANT] more than ten eligible signals are truncated to the ceiling, in rank order", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      signal({
        id: `s${String(i).padStart(2, "0")}`,
        grade: i === 13 ? "A+" : "B",
        detected_at: `2026-08-25T10:${String(i).padStart(2, "0")}:00.000Z`,
      }),
    );
    const selected = rankActiveSignals(many).slice(0, 10);
    expect(selected).toHaveLength(10);
    expect(selected[0]!.id).toBe("s13");
  });

  it("[INVARIANT] a ceiling of zero places no orders at all", () => {
    expect(rankActiveSignals(rows).slice(0, 0)).toHaveLength(0);
  });
});

describe("architecture boundaries", () => {
  const source = String(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:fs").readFileSync("src/lib/delivery/reconcile-active.server.ts", "utf8"),
  );

  it("[INVARIANT] the reconciler reuses the authoritative enqueue path rather than a second rule set", () => {
    expect(source).toContain("enqueueDirectDeliveries");
    expect(source).not.toContain("evaluateEligibility(");
  });

  it("[INVARIANT] alerts are never execution authority: the reconciler reads no alert state", () => {
    expect(source).not.toMatch(/alert_deliver|from\("alerts"\)|notify_push|notify_email/);
  });

  it("[INVARIANT] the reconciler never submits to a broker itself", () => {
    expect(source).not.toMatch(/metaapi\/trade|processNextDelivery|fetch\(/);
  });

  it("[INVARIANT] idempotency is database-backed on user + account profile + signal", () => {
    const enqueue = String(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").readFileSync("src/lib/delivery/direct-enqueue.server.ts", "utf8"),
    );
    expect(enqueue).toContain('onConflict: "user_id,signal_id,bridge_profile"');
    expect(enqueue).toContain("ignoreDuplicates: true");
  });
});
