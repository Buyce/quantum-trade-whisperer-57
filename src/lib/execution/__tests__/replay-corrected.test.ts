/**
 * Replay V2 — execution-credibility suite (blocking).
 *
 * Every case here is a SPECIFICATION of the corrected labeller, not a
 * characterisation: if one of these changes, the labels are no longer credible.
 * The last block re-runs Replay V1 to prove production semantics did not move.
 */
import { describe, expect, it } from "vitest";
import { replaySetupV2 } from "../replay-v2";
import { replaySetup } from "../replay";
import {
  REPLAY_V1_CODE_HASH,
  REPLAY_V2_CODE_HASH,
  EXECUTION_POLICY_V2,
} from "../replay-registry";
import { longSetup, DETECTED_AT } from "@/test/fixtures/replay-fixtures";
import type { Candle } from "@/lib/scanner/types";

/** Bars are M15-aligned; TIF (30m) expires at 09:30Z. */
const B0 = "2026-08-20T09:00:00.000Z"; // wholly live
const B1 = "2026-08-20T09:15:00.000Z"; // ends exactly at the deadline — live
const B2 = "2026-08-20T09:30:00.000Z"; // starts at the deadline — dead
const B3 = "2026-08-20T09:45:00.000Z";
const DAY_LATER = "2026-08-21T09:15:00.000Z"; // past the 24h vertical barrier

const bar = (
  time: string,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle => ({ time, open, high, low, close });

/** Never approaches the limit: lows stay 15 pips above entry. */
const AWAY = (time: string) => bar(time, 1.1025, 1.1035, 1.1015, 1.103);

describe("replaySetupV2 — fill leg and time in force", () => {
  it("[UNIT] never filled: the limit is never reached inside TIF", () => {
    const s = replaySetupV2(longSetup(), [AWAY(B0), AWAY(B1), AWAY(B2)]);
    expect(s.status).toBe("resolved");
    expect(s.outcome).toBe("never_filled");
    expect(s.grossR).toBe(0);
    expect(s.label).toBe(0);
    // Closest low 1.10150 vs entry 1.10000 with ATR 0.00200 → 0.75 ATR away.
    expect(s.missDistanceAtr).toBeCloseTo(0.75, 6);
    expect(s.fillAmbiguousTif).toBe(false);
  });

  it("[UNIT] filled immediately: the forming detection bar can fill", () => {
    const s = replaySetupV2(longSetup(), [bar(B0, 1.1005, 1.1015, 1.0999, 1.101)]);
    expect(s.fillBarTime).toBe(B0);
    expect(s.fillPrice).toBeCloseTo(1.1, 10);
    expect(s.riskPriceActual).toBeCloseTo(0.005, 10);
    expect(s.status).toBe("open");
  });

  it("[UNIT] filled exactly before expiry: a bar ending ON the deadline still fills", () => {
    const s = replaySetupV2(longSetup(), [AWAY(B0), bar(B1, 1.1005, 1.1015, 1.0999, 1.101)]);
    expect(s.fillBarTime).toBe(B1);
    expect(s.fillAmbiguousTif).toBe(false);
  });

  it("[UNIT] touch AFTER expiry never fills — the order was already dead", () => {
    const s = replaySetupV2(longSetup(), [AWAY(B0), AWAY(B1), bar(B2, 1.1005, 1.101, 1.0999, 1.1)]);
    expect(s.outcome).toBe("never_filled");
    expect(s.fillBarTime).toBeNull();
    expect(s.fillAmbiguousTif).toBe(true);
    expect(s.label).toBe(0);
  });

  it("[UNIT] gap-through fill prices at the open and measures R against ACTUAL risk", () => {
    const s = replaySetupV2(longSetup(), [
      AWAY(B0),
      bar(B1, 1.0985, 1.1055, 1.098, 1.105),
    ]);
    expect(s.fillPrice).toBeCloseTo(1.0985, 10);
    expect(s.fillGapThrough).toBe(true);
    expect(s.riskPriceActual).toBeCloseTo(0.0035, 10);
    // A gap fill existed for the whole bar, so same-bar TP1 is credited.
    expect(s.outcome).toBe("win");
    expect(s.grossR).toBeCloseTo((1.105 - 1.0985) / 0.0035, 8);
    expect(s.grossR).not.toBeCloseTo(1, 3);
  });

  it("[UNIT] gap-through that opens beyond the stop is a data-quality outcome, not a loss", () => {
    const s = replaySetupV2(longSetup(), [AWAY(B0), bar(B1, 1.094, 1.0945, 1.093, 1.0935)]);
    expect(s.outcome).toBe("gap_beyond_stop");
    expect(s.label).toBeNull();
    expect(s.grossR).toBeNull();
    expect(s.fillGapThrough).toBe(true);
  });

  it("[UNIT] an invalid plan fails closed with a NULL label", () => {
    for (const patch of [{ riskPrice: 0 }, { stopLoss: 1.101 }, { tp1: 1.099 }]) {
      const s = replaySetupV2(longSetup(patch), [bar(B0, 1.1, 1.106, 1.094, 1.1)]);
      expect(s.outcome).toBe("invalid_plan");
      expect(s.label).toBeNull();
      expect(s.grossR).toBeNull();
    }
  });
});

describe("replaySetupV2 — barriers, causality and execution policy", () => {
  /** Ordinary intrabar fill on B0 that touches nothing else. */
  const cleanFill = bar(B0, 1.1005, 1.1015, 1.0999, 1.101);

  it("[UNIT] stop only resolves at exactly -1R with a determinable chronology", () => {
    const s = replaySetupV2(longSetup(), [cleanFill, bar(B1, 1.1, 1.1005, 1.0949, 1.095)]);
    expect(s.outcome).toBe("loss");
    expect(s.grossR).toBeCloseTo(-1, 10);
    expect(s.stopBeforeTp1).toBe(true);
    expect(s.tp1BeforeStop).toBe(false);
    expect(s.stopGapThrough).toBe(false);
  });

  it("[UNIT] a bar opening beyond the stop exits at the OPEN and can lose more than 1R", () => {
    const s = replaySetupV2(longSetup(), [cleanFill, bar(B1, 1.093, 1.0935, 1.0925, 1.093)]);
    expect(s.outcome).toBe("loss");
    expect(s.stopGapThrough).toBe(true);
    expect(s.grossR).toBeCloseTo((1.093 - 1.1) / 0.005, 8);
    expect(s.grossR!).toBeLessThan(-1);
  });

  it("[UNIT] TP1 pays exactly 1R under single_exit_first_target", () => {
    const s = replaySetupV2(longSetup(), [cleanFill, bar(B1, 1.1, 1.1051, 1.0999, 1.105)]);
    expect(s.executionPolicy).toBe(EXECUTION_POLICY_V2);
    expect(s.outcome).toBe("win");
    expect(s.label).toBe(1);
    expect(s.grossR).toBeCloseTo(1, 10);
    expect(s.firstTargetTouched).toBe(1);
    expect(s.maxTargetTouched).toBe(1);
    expect(s.tp1BeforeStop).toBe(true);
  });

  it("[UNIT] TP2 and TP3 touches are analytics only — the realized exit stays TP1", () => {
    const tp2 = replaySetupV2(longSetup(), [cleanFill, bar(B1, 1.1, 1.1101, 1.0999, 1.11)]);
    expect(tp2.grossR).toBeCloseTo(1, 10);
    expect(tp2.maxTargetTouched).toBe(1);
    const tp3 = replaySetupV2(longSetup(), [cleanFill, bar(B1, 1.1, 1.1155, 1.0999, 1.115)]);
    expect(tp3.grossR).toBeCloseTo(1, 10);
    expect(tp3.maxTargetTouched).toBe(1);
    expect(tp3.firstTargetTouched).toBe(1);
  });

  it("[UNIT] a gap through TP1 is credited at the TARGET, never the better open", () => {
    const s = replaySetupV2(longSetup(), [cleanFill, bar(B1, 1.108, 1.109, 1.1075, 1.108)]);
    expect(s.outcome).toBe("win");
    expect(s.grossR).toBeCloseTo(1, 10);
  });

  it("[UNIT] stop and TP in the same post-fill bar resolves as a loss with NULL chronology", () => {
    const s = replaySetupV2(longSetup(), [cleanFill, bar(B1, 1.1, 1.1051, 1.0949, 1.1)]);
    expect(s.outcome).toBe("loss");
    expect(s.grossR).toBeCloseTo(-1, 10);
    expect(s.ambiguousBars).toBe(1);
    expect(s.adjudication).toBe("m15_conservative_fallback");
    expect(s.tp1BeforeStop).toBeNull();
    expect(s.stopBeforeTp1).toBeNull();
  });

  it("[UNIT] entry, stop and TP in ONE bar resolves as a loss and records the unproven touch", () => {
    const s = replaySetupV2(longSetup(), [bar(B0, 1.101, 1.106, 1.094, 1.1)]);
    expect(s.outcome).toBe("loss");
    expect(s.grossR).toBeCloseTo(-1, 10);
    expect(s.ambiguousBars).toBe(1);
    expect(s.ambiguousBarTargetTouch).toBe(1);
    expect(s.fillBarExcursionAmbiguous).toBe(true);
  });

  it("[UNIT] an ordinary fill bar that also touches TP1 credits NOTHING and stays open", () => {
    const s = replaySetupV2(longSetup(), [bar(B0, 1.1005, 1.1051, 1.0999, 1.105)]);
    expect(s.status).toBe("open");
    expect(s.outcome).toBeNull();
    expect(s.firstTargetTouched).toBeNull();
    expect(s.maxTargetTouched).toBeNull();
    expect(s.ambiguousBarTargetTouch).toBe(1);
    expect(s.adjudication).toBe("m15_conservative_fallback");
    // Adjudication resumes on the next candle — here it stops out.
    const next = replaySetupV2(longSetup(), [
      bar(B0, 1.1005, 1.1051, 1.0999, 1.105),
      bar(B1, 1.1, 1.1005, 1.0949, 1.095),
    ]);
    expect(next.outcome).toBe("loss");
    expect(next.tp1BeforeStop).toBeNull();
    expect(next.stopBeforeTp1).toBeNull();
  });

  it("[UNIT] MFE/MAE exclude an ordinary fill bar and include a gap-at-open fill bar", () => {
    const ordinary = replaySetupV2(longSetup(), [bar(B0, 1.1005, 1.1045, 1.0999, 1.104)]);
    expect(ordinary.mfeR).toBe(0);
    expect(ordinary.maeR).toBe(0);
    expect(ordinary.fillBarExcursionAmbiguous).toBe(true);

    const gapped = replaySetupV2(longSetup(), [AWAY(B0), bar(B1, 1.0985, 1.1045, 1.098, 1.104)]);
    expect(gapped.fillBarExcursionAmbiguous).toBe(false);
    expect(gapped.mfeR).toBeGreaterThan(0);
    expect(gapped.maeR).toBeGreaterThan(0);
  });
});

describe("replaySetupV2 — vertical barrier and data gaps", () => {
  const cleanFill = bar(B0, 1.1005, 1.1015, 1.0999, 1.101);

  it("[UNIT] vertical expiry positive marks to the close over ACTUAL risk", () => {
    const s = replaySetupV2(longSetup(), [cleanFill, bar(DAY_LATER, 1.101, 1.1025, 1.0999, 1.102)]);
    expect(s.outcome).toBe("expired");
    expect(s.grossR).toBeCloseTo(0.4, 10);
    expect(s.label).toBe(0);
  });

  it("[UNIT] vertical expiry negative is reported as a negative R, not a loss label", () => {
    const s = replaySetupV2(longSetup(), [cleanFill, bar(DAY_LATER, 1.0995, 1.1, 1.0985, 1.099)]);
    expect(s.outcome).toBe("expired");
    expect(s.grossR).toBeCloseTo(-0.2, 10);
    expect(s.label).toBe(0);
  });

  it("[UNIT] missing candles never invent an outcome", () => {
    const s = replaySetupV2(longSetup(), []);
    expect(s.status).toBe("open");
    expect(s.outcome).toBeNull();
    expect(s.replayCursor).toBeNull();
  });

  it("[UNIT] a weekend closure leaves an unresolved row open at its cursor", () => {
    // Filled on Friday, then no candles at all until Monday: nothing to judge.
    const s = replaySetupV2(longSetup(), [cleanFill]);
    expect(s.status).toBe("open");
    expect(s.replayCursor).toBe(B0);
    // A resumed run consumes only bars strictly after the cursor.
    const resumed = replaySetupV2(
      longSetup({ replayCursor: B0, filledAt: B0, fillPrice: 1.1 }),
      [cleanFill, bar(B3, 1.1, 1.1005, 1.0949, 1.095)],
    );
    expect(resumed.outcome).toBe("loss");
    expect(resumed.replayCursor).toBe(B3);
  });

  it("[UNIT] short setups mirror long adjudication exactly", () => {
    const short = longSetup({
      direction: "short",
      entryPrice: 1.1,
      stopLoss: 1.105,
      tp1: 1.095,
      tp2: 1.09,
      tp3: 1.085,
    });
    const s = replaySetupV2(short, [
      bar(B0, 1.0995, 1.1001, 1.099, 1.0995),
      bar(B1, 1.0995, 1.0996, 1.0949, 1.095),
    ]);
    expect(s.fillBarTime).toBe(B0);
    expect(s.outcome).toBe("win");
    expect(s.grossR).toBeCloseTo(1, 10);
  });
});

describe("replay identity is immutable", () => {
  it("[INVARIANT] the registered replay semantics hashes never drift", () => {
    expect(REPLAY_V1_CODE_HASH).toBe("b1bc0ac96d59dec4");
    expect(REPLAY_V2_CODE_HASH).toBe("270450b8cc142a73");
  });

  it("[V1_CHARACTERIZATION] Replay V1 gap fills are still paid on PLANNED risk", () => {
    // The production labeller must be untouched by this work: V1 keeps the
    // planned-risk denominator that V2 corrects.
    const gapBars = [AWAY(B0), bar(B1, 1.0985, 1.1055, 1.098, 1.105)];
    const v1 = replaySetup(longSetup(), gapBars);
    const v2 = replaySetupV2(longSetup(), gapBars);
    expect(v1.fillPrice).toBeCloseTo(1.0985, 10);
    expect(v1.outcome).toBe("win");
    expect(v1.realizedR).not.toBeCloseTo(v2.grossR!, 3);
  });
});
