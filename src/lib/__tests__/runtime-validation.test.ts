import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("runtime validation safety", () => {
  const src = read("src/lib/runtime-validation.functions.ts");

  it("[INVARIANT] has no broker trade submission path", () => {
    expect(src).not.toMatch(/metaapi\/trade\.server/);
    expect(src).not.toMatch(/submitMarketOrder|submitPendingOrder/);
    expect(src).not.toMatch(/live_auto|live_confirm/);
    expect(src).toContain("tradeEndpointCalled: false");
    expect(src).toContain("dryRun: true");
  });

  it("[INVARIANT] is owner gated and uses the non-trading margin diagnostic", () => {
    expect(src).toContain("requireSupabaseAuth");
    expect(src).toContain("OWNER_EMAIL");
    expect(src).toContain("runDiagnoseBrokerMargin");
    expect(src).toContain("accountExecutionPolicy");
  });
});
