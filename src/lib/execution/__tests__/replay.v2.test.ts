import { describe, expect, it } from "vitest";
import { replaySetup } from "../replay";
import { ORDER_TIF_MINUTES } from "@/lib/scanner/types";
import {
  DETECTED_AT,
  gapThroughLimit,
  longSetup,
  postTifTouch,
} from "@/test/fixtures/replay-fixtures";

/**
 * INTENDED_V2 — NON-BLOCKING BY DESIGN.
 *
 * This file runs only in the `report` project (`bun run test:report`). It states
 * what a corrected V2 engine SHOULD do. Failures here are not regressions: they
 * are the measured distance between V1 and the intended model. Nothing in CI
 * gates on this file, and nothing here may be used to justify changing V1
 * without a baseline recapture.
 */
describe("replay — intended V2 semantics (non-blocking)", () => {
  it.fails("[INTENDED_V2] a touch after the TIF deadline should NOT fill", () => {
    const state = replaySetup(longSetup(), postTifTouch.candles);
    const minutesLate =
      (new Date(state.filledAt!).getTime() - new Date(DETECTED_AT).getTime()) / 60_000;
    expect(minutesLate).toBeLessThanOrEqual(ORDER_TIF_MINUTES);
  });

  it.fails(
    "[INTENDED_V2] R should be measured against the ACTUAL filled risk, not planned risk",
    () => {
      // Filled 1.0985, stop 1.0950 → real risk 0.0035; TP1 at 1.1050 is ~1.857R.
      const state = replaySetup(longSetup(), gapThroughLimit.candles);
      const actualRisk = Math.abs(state.fillPrice! - 1.095);
      const expectedR = (1.105 - state.fillPrice!) / actualRisk;
      expect(state.realizedR).toBeCloseTo(expectedR, 6);
    },
  );
});
