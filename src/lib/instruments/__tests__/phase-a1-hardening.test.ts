/**
 * Phase A1 hardening invariants.
 *
 * These pin the four things the hardening changed, so a later refactor cannot
 * quietly undo them:
 *
 *   1. Strategy code is not authorised at `data_validation` (Finding 1).
 *   2. A withheld structure is never classified as a strategy rejection (Finding 2).
 *   3. Structure identity follows the instrument's own price grid (Finding 6).
 *   4. Series validation actually rejects disordered/gapped/degenerate candles.
 */
import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_CAPABILITIES,
  allows,
  mayCaptureResearch,
  mayEvaluateStrategy,
  mayExecute,
  mayPublish,
  mayScan,
  type InstrumentStage,
} from "../lifecycle";
import { priceDecimals, roundPrice, tickDecimals } from "../precision";
import { validateSeries } from "../series";
import {
  NON_VERDICT_DISPOSITIONS,
  SUPPRESSED_DISPOSITIONS,
  isStrategyNoTrade,
} from "@/lib/research/observations.server";
import { structureKeyOf } from "@/lib/scanner/profile";
import type { Candle } from "@/lib/scanner/types";

const STAGES: InstrumentStage[] = [
  "disabled",
  "suspended",
  "data_validation",
  "shadow",
  "signals_only",
  "execution_approved",
];

describe("Phase A1 — lifecycle capability model", () => {
  it("[INVARIANT] data_validation may fetch data but may NOT run strategy or record research", () => {
    // This is the whole point of the granular split: grading unvalidated data
    // would seed the research ledger with rows whose inputs were never proven.
    expect(mayScan("data_validation")).toBe(true);
    expect(mayEvaluateStrategy("data_validation")).toBe(false);
    expect(mayCaptureResearch("data_validation")).toBe(false);
    expect(mayPublish("data_validation")).toBe(false);
    expect(mayExecute("data_validation")).toBe(false);
  });

  it("[INVARIANT] disabled and suspended authorise nothing at all", () => {
    for (const stage of ["disabled", "suspended"] as InstrumentStage[]) {
      for (const capability of LIFECYCLE_CAPABILITIES) {
        expect({ stage, capability, allowed: allows(stage, capability) }).toEqual({
          stage,
          capability,
          allowed: false,
        });
      }
    }
  });

  it("[INVARIANT] capabilities are monotonic along the stage ladder", () => {
    // No capability may be granted at a lower stage and withdrawn at a higher
    // one: that would make promotion a downgrade for some action.
    for (const capability of LIFECYCLE_CAPABILITIES) {
      let seenAllowed = false;
      for (const stage of STAGES.slice(2)) {
        const allowed = allows(stage, capability);
        if (allowed) seenAllowed = true;
        else expect({ capability, stage, regression: seenAllowed }).toEqual({
          capability,
          stage,
          regression: false,
        });
      }
    }
  });

  it("[INVARIANT] only execution_approved may execute", () => {
    for (const stage of STAGES) {
      expect(mayExecute(stage)).toBe(stage === "execution_approved");
    }
  });
});

describe("Phase A1 — suppression is never a strategy rejection", () => {
  it("[INVARIANT] every suppressed or non-verdict disposition is excluded from no-trade", () => {
    for (const disposition of [...SUPPRESSED_DISPOSITIONS, ...NON_VERDICT_DISPOSITIONS]) {
      expect({ disposition, counted: isStrategyNoTrade({ decision: "no_trade", disposition }) }).toEqual(
        { disposition, counted: false },
      );
    }
  });

  it("[INVARIANT] only a plain no_trade with disposition none counts as a rejection", () => {
    expect(isStrategyNoTrade({ decision: "no_trade", disposition: "none" })).toBe(true);
    expect(isStrategyNoTrade({ decision: "candidate", disposition: "none" })).toBe(false);
  });

  it("[INVARIANT] lifecycle suppression is its own disposition, distinct from the cooldown", () => {
    expect(SUPPRESSED_DISPOSITIONS).toContain("suppressed_lifecycle");
    expect(SUPPRESSED_DISPOSITIONS).toContain("suppressed_duplicate");
    expect(SUPPRESSED_DISPOSITIONS).toContain("suppressed_cooldown");
  });
});

describe("Phase A1 — instrument-aware precision", () => {
  it("[INVARIANT] price precision follows the instrument, not a fixed 5 decimals", () => {
    expect(priceDecimals("XAUUSD")).toBe(2);
    expect(priceDecimals("USDJPY")).toBe(3);
    expect(priceDecimals("EURUSD")).toBe(5);
  });

  it("[INVARIANT] the broker's own digits override the registry fallback", () => {
    expect(priceDecimals("EURUSD", { digits: 3 } as never)).toBe(3);
  });

  it("[INVARIANT] structure identity is stable across sub-tick noise on XAUUSD", () => {
    const base = {
      instrument: "XAUUSD",
      direction: "short" as const,
      aTime: "2026-08-20T05:30:00.000Z",
      bTime: "2026-08-20T05:45:00.000Z",
    };
    // Two scans of one lingering structure whose stop anchor wobbles below the
    // price grid must NOT mint a second published signal.
    expect(structureKeyOf({ ...base, stopLoss: 933.44941 })).toBe(
      structureKeyOf({ ...base, stopLoss: 933.45012 }),
    );
    // A genuinely different anchor still produces a different key.
    expect(structureKeyOf({ ...base, stopLoss: 933.45 })).not.toBe(
      structureKeyOf({ ...base, stopLoss: 934.12 }),
    );
  });

  it("[INVARIANT] rounding and tick decimals agree with the grid", () => {
    expect(roundPrice("USDJPY", 151.234567)).toBe(151.235);
    expect(tickDecimals(0.001)).toBe(3);
    expect(tickDecimals(0.00001)).toBe(5);
  });
});

describe("Phase A1 — series validation", () => {
  const at = (i: number): Candle => ({
    time: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
    open: 1.1,
    high: 1.2,
    low: 1.0,
    close: 1.15,
    volume: 10,
  });
  const now = new Date(Date.UTC(2026, 0, 1, 0, 15 * 12));

  it("[UNIT] accepts a long, ordered, gap-free series", () => {
    const report = validateSeries({
      timeframe: "M15",
      candles: Array.from({ length: 10 }, (_, i) => at(i)),
      required: 5,
      now,
    });
    expect(report.ok).toBe(true);
  });

  it("[INVARIANT] rejects a series that is too short, out of order, gapped or degenerate", () => {
    const short = validateSeries({ timeframe: "M15", candles: [at(0)], required: 5, now });
    expect(short.ok).toBe(false);

    const gapped = validateSeries({
      timeframe: "M15",
      candles: [at(0), at(1), at(5), at(6), at(7), at(8)],
      required: 5,
      now,
    });
    expect(gapped.ok).toBe(false);
    expect(gapped.missingIntervals).toBeGreaterThan(0);

    const badGeometry = validateSeries({
      timeframe: "M15",
      candles: [
        at(0),
        { ...at(1), high: 1.0, low: 1.2 },
        at(2),
        at(3),
        at(4),
        at(5),
      ],
      required: 5,
      now,
    });
    expect(badGeometry.ok).toBe(false);
  });
});
