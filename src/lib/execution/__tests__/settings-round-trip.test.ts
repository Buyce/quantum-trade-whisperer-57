/**
 * Guards a whole class of silent bug: a settings field that the form WRITES but
 * the read query does not SELECT comes back undefined after the post-save
 * refetch, so the control re-hydrates to its default and appears to revert even
 * though the database holds the saved value. The intelligence gate did exactly
 * that. Every written column must be readable back.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SETTINGS_SELECT } from "@/lib/queries";

/** Columns written elsewhere (server-side bridge fn) or deliberately never read back. */
const NOT_READ_BACK = new Set([
  "user_id", // identity, not an editable control
  "equity_as_of", // provenance stamp; present in the projection anyway
]);

function writtenKeys(): string[] {
  const source = readFileSync("src/routes/_authenticated/settings.tsx", "utf8");
  const start = source.indexOf("await saveSettings({");
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("const bridge = await persistBridge", start));
  // Top-level object keys of the payload, including the spread-conditional one.
  const keys = new Set<string>();
  for (const match of body.matchAll(/(?:^|[\s{(])([a-z][a-z0-9_]*)\s*:/gim)) {
    keys.add(match[1] as string);
  }
  return [...keys];
}

describe("scanner settings read/write round trip", () => {
  const selected = new Set(SETTINGS_SELECT.split(",").map((c) => c.trim()));

  it("[INVARIANT] every column the settings form writes is selected back", () => {
    const missing = writtenKeys().filter(
      (key) => !NOT_READ_BACK.has(key) && !selected.has(key) && /_/.test(key),
    );
    expect(missing).toEqual([]);
  });

  it("[INVARIANT] the intelligence gate fields survive the round trip", () => {
    expect(selected.has("auto_intel_gate_enabled")).toBe(true);
    expect(selected.has("auto_intel_min_win_pct")).toBe(true);
    expect(selected.has("auto_intel_min_sample")).toBe(true);
  });
});
