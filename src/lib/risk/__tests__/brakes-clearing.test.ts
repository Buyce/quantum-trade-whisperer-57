import { describe, expect, it } from "vitest";
import { evaluateAccountBrakes } from "../brakes.server";
import { brakesConfigured, readBrakeLimits } from "../brakes";

/**
 * A stored hold must be released the moment its owner stops configuring any
 * limit. Anything else makes the app announce a pause nothing enforces.
 */
function fakeDb() {
  const calls: { table: string; patch: Record<string, unknown>; ids: string[] }[] = [];
  const db = {
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            in(_col: string, ids: string[]) {
              return {
                eq(_c: string, _v: unknown) {
                  calls.push({ table, patch, ids });
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

describe("brakes: stale hold clearing", () => {
  it("[INVARIANT] clears the stored hold for an account whose owner disabled the protection", async () => {
    const { db, calls } = fakeDb();
    const out = await evaluateAccountBrakes(
      db as never,
      [{ id: "acct-1", user_id: "user-1" }] as never,
      new Map([
        [
          "user-1",
          {
            drawdown_brakes_enabled: false,
            daily_loss_limit_percent: 3,
            weekly_loss_limit_percent: 0,
            consecutive_loss_limit: 4,
            consecutive_loss_pause_hours: 0,
            max_drawdown_percent: 0,
          },
        ],
      ]) as never,
      Date.parse("2026-09-09T10:00:00Z"),
    );

    expect(out.size).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("account_risk_state");
    expect(calls[0]!.ids).toEqual(["acct-1"]);
    expect(calls[0]!.patch["paused"]).toBe(false);
    expect(calls[0]!.patch["pause_reason"]).toBeNull();
    expect(calls[0]!.patch["resume_after"]).toBeNull();
    expect(calls[0]!.patch["cancelled_matching_orders"]).toBe(0);
    // Measurements are observations, not verdicts: they are never overwritten here.
    expect(calls[0]!.patch).not.toHaveProperty("peak_equity");
  });

  it("[INVARIANT] treats every limit at zero as unconfigured, so no hold is reported", () => {
    const limits = readBrakeLimits({
      drawdown_brakes_enabled: true,
      daily_loss_limit_percent: 0,
      weekly_loss_limit_percent: 0,
      consecutive_loss_limit: 0,
      consecutive_loss_pause_hours: 0,
      max_drawdown_percent: 0,
    } as never);
    expect(brakesConfigured(limits)).toBe(false);
  });
});
