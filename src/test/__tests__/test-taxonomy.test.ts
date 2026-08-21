import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Meta-gate: every test in this repository MUST declare its class.
 *
 *  [UNIT]                 — deterministic behaviour of a pure helper.
 *  [V1_CHARACTERIZATION]  — pins CURRENT V1 behaviour, including known defects.
 *                           Failing means V1 behaviour changed; that is either a
 *                           regression or a deliberate model change that needs a
 *                           baseline recapture.
 *  [INVARIANT]            — model-independent safety property that must hold for
 *                           any version of the engine.
 *  [INTENDED_V2]          — desired future behaviour. Lives only in *.v2.test.ts
 *                           and is NEVER blocking.
 */
const CLASSES = ["[UNIT]", "[V1_CHARACTERIZATION]", "[INVARIANT]", "[INTENDED_V2]"];
const ROOT = join(process.cwd(), "src");

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testFiles(full, out);
    else if (entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const FILES = testFiles(ROOT);
/** Matches the title argument of it(...) / test(...) in either quote style. */
const TITLE = /\b(?:it|test)(?:\.each\([\s\S]*?\))?\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

describe("test taxonomy", () => {
  it("[INVARIANT] the suite discovers test files, so this gate cannot pass vacuously", () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  it("[INVARIANT] every test title starts with a declared test class", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(TITLE)) {
        const title = match[2] ?? "";
        if (!CLASSES.some((c) => title.startsWith(c))) offenders.push(`${file}: ${title}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("[INVARIANT] INTENDED_V2 tests only ever live in non-blocking *.v2.test.ts files", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file.endsWith(".v2.test.ts")) continue;
      if (readFileSync(file, "utf8").includes("[INTENDED_V2]")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
