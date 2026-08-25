import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { resolveWriteOnlySecret } from "@/lib/delivery/write-only-secret";

describe("write-only bridge credential", () => {
  it("[INVARIANT] blank input preserves the existing credential", () => {
    expect(resolveWriteOnlySecret("   ", "saved-fixture-secret")).toEqual({
      effective: "saved-fixture-secret",
      replacement: null,
    });
  });

  it("[INVARIANT] a nonblank input explicitly replaces the credential", () => {
    expect(resolveWriteOnlySecret("  replacement-fixture-secret ", "old-fixture-secret")).toEqual({
      effective: "replacement-fixture-secret",
      replacement: "replacement-fixture-secret",
    });
  });

  it("[UNIT] reports no effective credential when neither side has one", () => {
    expect(resolveWriteOnlySecret("", null)).toEqual({ effective: "", replacement: null });
  });

  it("[INVARIANT] browser settings restore execution switches but never select the secret", () => {
    const source = readFileSync("src/lib/queries.ts", "utf8");
    const settingsQuery = source.slice(
      source.indexOf("export const SETTINGS_SELECT"),
      source.indexOf("export function instrumentHealthQuery"),
    );
    expect(settingsQuery).toContain("execution_enabled");
    expect(settingsQuery).toContain("execution_dry_run");
    expect(settingsQuery).toContain("exposure_limit_enabled");
    expect(settingsQuery).not.toContain("webhook_secret");
  });

  it("[INVARIANT] the browser writer does not require UPDATE access to user_id", () => {
    const source = readFileSync("src/lib/queries.ts", "utf8");
    const saveSettings = source.slice(
      source.indexOf("export async function saveSettings"),
      source.indexOf("export function regimeStatsQuery"),
    );
    expect(saveSettings).not.toContain(".upsert(");
    expect(saveSettings).toContain(".update(patch as never)");
    expect(saveSettings).toContain(".insert(input as never)");
  });
});
