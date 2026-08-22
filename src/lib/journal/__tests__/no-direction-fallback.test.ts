/**
 * Source invariants: neither outcome writer may re-introduce a `?? "long"`
 * direction fallback, and the journal UI may not label a self-reported price
 * "Verified".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const WRITERS = ["src/lib/trade-journal.functions.ts", "src/lib/mcp/tools/update-trade-outcome.ts"];

describe("direction is never inferred", () => {
  for (const file of WRITERS) {
    const src = read(file);

    it(`[INVARIANT] ${file} has no long fallback`, () => {
      expect(src).not.toMatch(/\?\?\s*"long"/);
    });

    it(`[INVARIANT] ${file} resolves legacy direction from the referenced signal`, () => {
      expect(src).toMatch(/from\("scanned_signals"\)/);
      expect(src).toMatch(/raw === "long" \|\| raw === "short"/);
    });
  }
});

describe("journal UI wording is truthful", () => {
  const src = read("src/routes/_authenticated/history.tsx");

  it("[INVARIANT] no Verified badge on self-reported prices", () => {
    expect(src).not.toMatch(/Verified ·/);
    expect(src).toMatch(/Self-reported · \{agent \? "agent" : "you"\}/);
  });

  it("[INVARIANT] no 'verified win rate' or 'unverified' claims", () => {
    expect(src).not.toMatch(/verified win rate/i);
    expect(src).not.toMatch(/stay unverified/i);
    expect(src).toMatch(/price-backed win rate/);
    expect(src).toMatch(/execution prices missing/);
  });
});
