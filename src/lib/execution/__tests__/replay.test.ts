import { describe, expect, it } from "vitest";
import { replaySetup } from "../replay";
import { ORDER_TIF_MINUTES, SIGNAL_MAX_AGE_HOURS } from "@/lib/scanner/types";
import {
  DETECTED_AT,
  gapThroughLimit,
  longSetup,
  neverFilled,
  postTifTouch,
  sameCandleAllBarriers,
  verticalExpiry,
} from "@/test/fixtures/replay-fixtures";

describe("replaySetup — V1 characterization of ambiguous resolutions", () => {
  it("[V1_CHARACTERIZATION] a candle containing entry, stop and target resolves as a loss (stop assumed first)", () => {
    // Intrabar sequence is unknowable from M15 OHLC. V1 deliberately assumes the
    // worse ordering. CHARACTERISATION.md #1.
    const state = replaySetup(longSetup(), sameCandleAllBarriers.candles);
    expect(state.status).toBe("resolved");
    expect(state.outcome).toBe("loss");
    expect(state.realizedR).toBe(-1);
    expect(state.label).toBe(0);
    expect(state.filledAt).toBe(DETECTED_AT);
  });

  it("[V1_CHARACTERIZATION] a gap-through fill is priced at the open but R still uses PLANNED risk", () => {
    // Filled at 1.0985 with a stop at 1.0950 — real risk was 0.0035, not the
    // planned 0.0050 — yet TP1 is credited as exactly 1.00R. CHARACTERISATION.md #3.
    const state = replaySetup(longSetup(), gapThroughLimit.candles);
    expect(state.fillPrice).toBeCloseTo(1.0985, 10);
    expect(state.slippagePips).toBeCloseTo(15, 6);
    expect(state.outcome).toBe("win");
    expect(state.realizedR).toBeCloseTo(1, 10);
    expect(state.label).toBe(1);
  });

  it("[V1_CHARACTERIZATION] a touch AFTER the TIF deadline still fills", () => {
    // The fill test runs before the deadline test, so a limit that is only
    // reached 45 minutes after detection (TIF = 30) is treated as filled.
    // CHARACTERISATION.md #4.
    expect(ORDER_TIF_MINUTES).toBe(30);
    const state = replaySetup(longSetup(), postTifTouch.candles);
    expect(state.filledAt).toBe("2026-08-20T09:45:00.000Z");
    const minutesLate =
      (new Date(state.filledAt!).getTime() - new Date(DETECTED_AT).getTime()) / 60_000;
    expect(minutesLate).toBeGreaterThan(ORDER_TIF_MINUTES);
    expect(state.outcome).toBe("win");
  });

  it("[V1_CHARACTERIZATION] the vertical barrier marks to the barrier candle's close", () => {
    expect(SIGNAL_MAX_AGE_HOURS).toBe(24);
    const state = replaySetup(longSetup(), verticalExpiry.candles);
    expect(state.outcome).toBe("expired");
    // close 1.1020, fill 1.1000, risk 0.0050 → +0.4R, and the ML label is 0.
    expect(state.realizedR).toBeCloseTo(0.4, 10);
    expect(state.label).toBe(0);
  });

  it("[V1_CHARACTERIZATION] never_filled records miss distance in ATR and realizedR 0", () => {
    const state = replaySetup(longSetup(), neverFilled.candles);
    expect(state.outcome).toBe("never_filled");
    expect(state.realizedR).toBe(0);
    expect(state.label).toBe(0);
    // Closest low 1.10150 vs entry 1.10000 with ATR 0.00200 → 0.75 ATR away.
    expect(state.missDistanceAtr).toBeCloseTo(0.75, 6);
  });

  it("[V1_CHARACTERIZATION] miss distance is null when ATR is unknown", () => {
    const state = replaySetup(longSetup({ atr: null as unknown as number }), neverFilled.candles);
    expect(state.outcome).toBe("never_filled");
    expect(state.missDistanceAtr).toBeNull();
  });

  it("[V1_CHARACTERIZATION] a fresh run replays the in-progress detection bar", () => {
    // The bar stamped at detection time is still forming, so it is consumed.
    const state = replaySetup(longSetup(), verticalExpiry.candles.slice(0, 1));
    expect(state.filledAt).toBe(DETECTED_AT);
    expect(state.status).toBe("open");
    expect(state.replayCursor).toBe(DETECTED_AT);
  });

  it("[UNIT] a resumed run consumes only bars strictly after the stored cursor", () => {
    const state = replaySetup(
      longSetup({ replayCursor: "2026-08-20T09:00:00.000Z" }),
      neverFilled.candles,
    );
    expect(state.replayCursor).toBe("2026-08-20T09:45:00.000Z");
  });

  it("[INVARIANT] a non-positive planned risk fails closed instead of dividing by zero", () => {
    for (const riskPrice of [0, -0.001, Number.NaN, Number.POSITIVE_INFINITY]) {
      const state = replaySetup(longSetup({ riskPrice }), verticalExpiry.candles);
      expect(state.status).toBe("resolved");
      expect(state.outcome).toBe("never_filled");
      expect(state.label).toBe(0);
    }
  });

  it("[INVARIANT] short setups mirror long resolution exactly", () => {
    const short = longSetup({
      direction: "short",
      entryPrice: 1.1,
      stopLoss: 1.105,
      tp1: 1.095,
      tp2: 1.09,
      tp3: 1.085,
    });
    const state = replaySetup(short, [
      { time: DETECTED_AT, open: 1.0995, high: 1.1001, low: 1.099, close: 1.0995 },
      { time: "2026-08-20T09:15:00.000Z", open: 1.0995, high: 1.0996, low: 1.0949, close: 1.095 },
    ]);
    expect(state.filledAt).toBe(DETECTED_AT);
    expect(state.outcome).toBe("win");
    expect(state.realizedR).toBeCloseTo(1, 10);
  });

  it("[INVARIANT] the target ladder is monotonic in R — a deeper target never pays less", () => {
    const reachTp3 = replaySetup(longSetup(), [
      { time: DETECTED_AT, open: 1.1, high: 1.1, low: 1.0999, close: 1.1 },
      { time: "2026-08-20T09:15:00.000Z", open: 1.1, high: 1.1155, low: 1.0999, close: 1.115 },
    ]);
    const reachTp1 = replaySetup(longSetup(), [
      { time: DETECTED_AT, open: 1.1, high: 1.1, low: 1.0999, close: 1.1 },
      { time: "2026-08-20T09:15:00.000Z", open: 1.1, high: 1.1051, low: 1.0999, close: 1.105 },
    ]);
    expect(reachTp1.realizedR).toBeCloseTo(1, 10);
    expect(reachTp3.realizedR).toBeCloseTo(3, 10);
    expect(reachTp3.realizedR!).toBeGreaterThan(reachTp1.realizedR!);
  });
});
