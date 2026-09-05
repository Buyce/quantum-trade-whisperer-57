import { describe, expect, it } from "vitest";

import { parseExitPath, simulateVariant, type ExitPath } from "../exit-variants";
import type { PathBar } from "../replay-v2";
import { summariseVariants } from "@/lib/learning/exit-variants.server";

/** Bar helper: `h` and `l` are the bar's high and adverse excursion in R. */
const bar = (t: string, h: number | null, l: number | null, amb = false): PathBar => ({
  t,
  hR: h,
  lR: l,
  amb,
});

const path = (
  bars: PathBar[],
  targets: [number | null, number | null, number | null] = [2, 3, 4],
): ExitPath => ({
  bars,
  targetsR: targets,
  truncated: false,
});

describe("exit variants — baseline", () => {
  it("[UNIT] exits at the first target when it is reached first", () => {
    const out = simulateVariant(
      "single_exit_first_target",
      path([bar("t1", 0.5, 0.2), bar("t2", 2.1, 0.3)]),
    );
    expect(out).toMatchObject({ decidable: true, r: 2 });
  });

  it("[UNIT] takes -1R when the stop is reached first", () => {
    const out = simulateVariant("single_exit_first_target", path([bar("t1", 0.4, 1.2)]));
    expect(out).toMatchObject({ decidable: true, r: -1 });
  });

  it("[INVARIANT] a bar crossing both barriers is undecidable, not a loss", () => {
    const out = simulateVariant("single_exit_first_target", path([bar("t1", 2.5, 1.4)]));
    expect(out.decidable).toBe(false);
    expect(out.r).toBeNull();
  });

  it("[INVARIANT] an ambiguous bar is undecidable", () => {
    const out = simulateVariant(
      "single_exit_first_target",
      path([{ t: "t1", hR: null, lR: null, amb: true }]),
    );
    expect(out.decidable).toBe(false);
  });

  it("[INVARIANT] a path that never exits is undecidable, never marked to close", () => {
    const out = simulateVariant("single_exit_first_target", path([bar("t1", 0.5, 0.5)]));
    expect(out).toMatchObject({ decidable: false, r: null });
  });
});

describe("exit variants — partial with a runner", () => {
  it("[UNIT] blends the first target with the deeper target when the runner reaches it", () => {
    const out = simulateVariant(
      "partial_tp1_runner_tp2",
      path([bar("t1", 2.1, 0.3), bar("t2", 3.2, -0.5)]),
    );
    // Half at 2R, half at 3R.
    expect(out).toMatchObject({ decidable: true, r: 2.5 });
  });

  it("[UNIT] blends the first target with break-even when the runner retraces", () => {
    const out = simulateVariant(
      "partial_tp1_runner_tp2",
      path([bar("t1", 2.1, 0.3), bar("t2", 2.4, 0.1)]),
    );
    expect(out).toMatchObject({ decidable: true, r: 1 });
  });

  it("[INVARIANT] reports no deeper target rather than inventing one", () => {
    const out = simulateVariant(
      "partial_tp1_runner_tp3",
      path([bar("t1", 2.1, 0.2)], [2, 3, null]),
    );
    expect(out.decidable).toBe(false);
    expect(out.reason).toContain("third target");
  });
});

describe("exit variants — break-even and trailing", () => {
  it("[UNIT] break-even returns 0R when price advances 1R then retraces to entry", () => {
    const out = simulateVariant(
      "breakeven_after_1r",
      path([bar("t1", 1.2, -0.2), bar("t2", 1.3, 0.05)]),
    );
    expect(out).toMatchObject({ decidable: true, r: 0 });
  });

  it("[UNIT] break-even still takes the first target when it comes first", () => {
    const out = simulateVariant("breakeven_after_1r", path([bar("t1", 2.2, -0.1)]));
    expect(out).toMatchObject({ decidable: true, r: 2 });
  });

  it("[UNIT] the trailing stop exits one R behind the best excursion", () => {
    const out = simulateVariant(
      "trail_1r",
      path([bar("t1", 1.0, -0.2), bar("t2", 3.0, -0.9), bar("t3", 3.0, -1.9)]),
    );
    expect(out).toMatchObject({ decidable: true, r: 2 });
  });

  it("[INVARIANT] a new best and the trailing stop in one bar is undecidable", () => {
    const out = simulateVariant("trail_1r", path([bar("t1", 1.5, -0.2), bar("t2", 3.0, -0.4)]));
    expect(out.decidable).toBe(false);
  });
});

describe("exit variant aggregation", () => {
  const stored = (targets: number[], bars: PathBar[]) => ({
    bars,
    targetsR: targets,
    truncated: false,
  });

  it("[INVARIANT] a variant with too few decidable setups reports unmeasured, not zero", () => {
    const rows = [
      {
        detected_at: "2026-01-01T00:00:00.000Z",
        instrument: "EURUSD",
        post_entry_path: stored([2, 3, 4], [bar("t1", 2.1, 0.2), bar("t2", 3.2, -0.4)]),
      },
    ];
    const summaries = summariseVariants(rows, Date.parse("2026-02-01T00:00:00.000Z"));
    const partial = summaries.find((s) => s.variant === "partial_tp1_runner_tp2");
    expect(partial?.meanR).toBeNull();
    expect(partial?.holdoutConfirmed).toBe(false);
    expect(partial?.blockers.length).toBeGreaterThan(0);
  });

  it("[INVARIANT] setups that have not matured are excluded", () => {
    const now = Date.parse("2026-01-01T06:00:00.000Z");
    const rows = [
      {
        detected_at: "2026-01-01T00:00:00.000Z",
        instrument: "EURUSD",
        post_entry_path: stored([2, 3, 4], [bar("t1", 2.1, 0.2)]),
      },
    ];
    const summaries = summariseVariants(rows, now);
    expect(summaries.every((s) => s.samples === 0)).toBe(true);
  });

  it("[UNIT] a stored path round-trips through the parser", () => {
    const parsed = parseExitPath(stored([2, 3, 4], [bar("t1", 2.1, 0.2)]));
    expect(parsed?.bars).toHaveLength(1);
    expect(parsed?.targetsR[0]).toBe(2);
  });

  it("[INVARIANT] an unusable stored value parses to null rather than an empty path", () => {
    expect(parseExitPath(null)).toBeNull();
    expect(parseExitPath({ bars: [] })).toBeNull();
  });
});
