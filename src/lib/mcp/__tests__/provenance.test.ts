/**
 * Agent-facing truthfulness gate. Self-reported prices are NOT broker verified,
 * so no agent-visible string may call a price-supplied row "Verified".
 * `verified` survives only as a documented legacy compatibility boolean.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const OUTCOME_TOOL = "src/lib/mcp/tools/update-trade-outcome.ts";

describe("MCP price provenance wording", () => {
  const src = read(OUTCOME_TOOL);

  it("[INVARIANT] no agent-visible string claims a self-reported row is Verified", () => {
    // Only quoted, agent-visible strings are checked; comments may explain.
    const strings = src.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    const offenders = strings.filter((s) => /(^|[^n])"?Verified\b|\bis verified\b/i.test(s))
      .filter(
        (s) =>
          !/legacy|NOT broker verified|verification_level|broker verification/i.test(s) &&
          s !== '"broker verified"',
      );
    expect(offenders).toEqual([]);
  });

  it("[INVARIANT] the tool always returns verification_level, and self_reported for supplied prices", () => {
    expect(src).toMatch(/verification_level: hasPrices \? "self_reported" : "unverified"/);
    // Present both on the DB write and on the returned payload.
    expect(src.match(/verification_level: hasPrices/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("[INVARIANT] the legacy `verified` boolean is documented as compatibility-only", () => {
    expect(src).toMatch(/LEGACY COMPATIBILITY BOOLEAN ONLY/);
    expect(src).toMatch(/verified_meaning/);
    expect(src).toMatch(/legacy compatibility flag: prices present\. Not a broker verification/);
  });

  it("[INVARIANT] plan_verified is never described as broker execution verified", () => {
    expect(src).toMatch(/plan_verified[\s\S]{0,200}never means broker execution verified/);
  });

  it("[INVARIANT] the tool description does not promise verification", () => {
    const description = src.split("inputSchema")[0]!;
    expect(description).toMatch(/NOT broker verified/);
    expect(description).not.toMatch(/self-reported\/verified/);
  });
});
