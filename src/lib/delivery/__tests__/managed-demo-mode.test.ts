/**
 * Regression: the armed demo mode must count as demo money.
 *
 * A delivery records the account's ARMED mode (`demo_auto`), never the bare word
 * `demo`. Comparing against `demo` alone silently downgraded every managed order
 * at the pre-send check and left the management pass selecting nothing, so no
 * part-close or stop move was ever performed.
 */
import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNT_MODES, isDemoAccountMode, isManagedPolicy } from "../execution";
import { manageDemoPositions } from "../manage-positions.server";
import { createFakeSupabase } from "@/test/fakes/supabase";

describe("isDemoAccountMode", () => {
  it("[INVARIANT] accepts the armed demo mode a delivery actually records", () => {
    expect(isDemoAccountMode("demo_auto")).toBe(true);
    expect(isDemoAccountMode("demo")).toBe(true);
  });

  it("[INVARIANT] never accepts a live mode", () => {
    for (const mode of ["live_auto", "live_confirm", "observe", null, undefined, ""]) {
      expect(isDemoAccountMode(mode)).toBe(false);
    }
  });
});

describe("manageDemoPositions selection", () => {
  it("[INVARIANT] asks for deliveries in every demo mode, not only 'demo'", async () => {
    const fake = createFakeSupabase(() => ({ data: [], error: null }));
    await manageDemoPositions(fake.client as never);

    const call = fake.calls.find((c) => c.table === "execution_deliveries");
    expect(call).toBeDefined();
    expect(call?.in["account_mode"]).toEqual([...DEMO_ACCOUNT_MODES]);
    expect(call?.in["account_mode"]).toContain("demo_auto");
    // Managed policies only: an unmanaged order has nothing to manage.
    for (const policy of call?.in["execution_policy"] ?? []) {
      expect(isManagedPolicy(policy as never)).toBe(true);
    }
  });
});
