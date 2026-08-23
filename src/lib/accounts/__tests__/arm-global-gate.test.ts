/**
 * Prompt 14 Stage 3/4 final closure (7) — global arming consistency.
 *
 * An account may not be SAVED as `demo_auto` while Demo Auto is unavailable
 * system-wide. Otherwise the row sits armed and starts trading later purely
 * because an operator flipped a switch — a state of the system the trader never
 * authorised. Live modes need the live switches for the same reason.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let controls: Record<string, boolean> = {};
let accountRow: Record<string, unknown> | null = null;
const updates: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "execution_controls" ? controls : accountRow,
            error: null,
          }),
        update: (row: Record<string, unknown>) => {
          updates.push(row);
          return api;
        },
        then: undefined,
      };
      // `update(...).eq(...).eq(...)` must settle like a promise.
      const withSettle = new Proxy(api, {
        get(t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve({ error: null });
          }
          return (t as Record<string | symbol, unknown>)[prop];
        },
      });
      return withSettle;
    },
  },
}));

import { setAccountMode } from "../arm.server";

const readyDemo = {
  phase: "ready",
  magic: 771234,
  metaapi_account_id: "ma-1",
  intent_conflict: false,
  trade_allowed: true,
  investor_mode: false,
  broker_account_type: "demo",
};

beforeEach(() => {
  updates.length = 0;
  accountRow = { ...readyDemo };
  controls = { live_execution_enabled: false, demo_auto_enabled: true, live_auto_enabled: false };
});

describe("arming against the global capability", () => {
  it("[REGRESSION] demo_auto is refused while Demo Auto is off system-wide", async () => {
    controls = { ...controls, demo_auto_enabled: false };
    await expect(setAccountMode("user-1", "acct-1", "demo_auto")).rejects.toThrow(
      /unavailable system-wide/i,
    );
    expect(updates).toHaveLength(0);
  });

  it("[UNIT] demo_auto is armed when the capability is available", async () => {
    await expect(setAccountMode("user-1", "acct-1", "demo_auto")).resolves.toEqual({
      mode: "demo_auto",
    });
    expect(updates).toEqual([{ mode: "demo_auto" }]);
  });

  it("[INVARIANT] live modes stay refused while live execution is disabled", async () => {
    accountRow = { ...readyDemo, broker_account_type: "real" };
    for (const mode of ["live_confirm", "live_auto"]) {
      await expect(setAccountMode("user-1", "acct-1", mode)).rejects.toThrow(/disabled system-wide/i);
    }
    expect(updates).toHaveLength(0);
  });

  it("[UNIT] standing down to observe is never blocked by a global switch", async () => {
    controls = { live_execution_enabled: false, demo_auto_enabled: false, live_auto_enabled: false };
    await expect(setAccountMode("user-1", "acct-1", "observe")).resolves.toEqual({
      mode: "observe",
    });
    expect(updates).toEqual([{ mode: "observe" }]);
  });
});
