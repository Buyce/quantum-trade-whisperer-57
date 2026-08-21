/**
 * Replay ambiguity fixtures — all V1_CHARACTERIZATION.
 *
 * These pin how the CURRENT (V1) triple-barrier replay resolves the genuinely
 * ambiguous cases. They assert reproducibility, NOT economic correctness. See
 * CHARACTERISATION.md for why each one is questionable and which prompt owns
 * changing it.
 */
import { defineFixture, m15Series, type MarketFixture } from "./provenance";
import type { ReplayInput } from "@/lib/execution/replay";

const BASE_PROVENANCE = {
  instrument: "EURUSD",
  timeframe: "M15" as const,
  modelVersion: 1,
  fixtureSchemaVersion: 1 as const,
  sourceType: "synthetic" as const,
  containsNoSecrets: true as const,
};

/** Detection time shared by every fixture below. TIF expires at 09:30Z. */
export const DETECTED_AT = "2026-08-20T09:00:00.000Z";

/** A canonical long setup: entry 1.1000, stop 1.0950 (50 pip = 1R). */
export function longSetup(overrides: Partial<ReplayInput> = {}): ReplayInput {
  return {
    direction: "long",
    instrument: "EURUSD",
    detectedAt: DETECTED_AT,
    entryPrice: 1.1,
    stopLoss: 1.095,
    tp1: 1.105,
    tp2: 1.11,
    tp3: 1.115,
    tp1R: null,
    tp2R: null,
    tp3R: null,
    riskPrice: 0.005,
    atr: 0.002,
    replayCursor: null,
    filledAt: null,
    fillPrice: null,
    mfeR: null,
    maeR: null,
    barsReplayed: 0,
    ...overrides,
  };
}

/** Entry, stop and target all inside the first M15 candle. */
export const sameCandleAllBarriers: MarketFixture = defineFixture({
  id: "replay/same-candle-all-barriers",
  provenance: {
    ...BASE_PROVENANCE,
    candleRange: { from: DETECTED_AT, to: DETECTED_AT },
    knownDefects: ["intrabar-order-unknowable-stop-assumed-first"],
  },
  candles: m15Series(DETECTED_AT, [
    { open: 1.101, high: 1.106, low: 1.094, close: 1.1 },
  ]),
});

/** Bar opens beyond the limit — a gap-through fill at the open. */
export const gapThroughLimit: MarketFixture = defineFixture({
  id: "replay/gap-through-limit",
  provenance: {
    ...BASE_PROVENANCE,
    candleRange: { from: DETECTED_AT, to: "2026-08-20T09:15:00.000Z" },
    knownDefects: ["planned-risk-r-denominator-after-gap-fill"],
  },
  candles: m15Series(DETECTED_AT, [
    { open: 1.0985, high: 1.0995, low: 1.098, close: 1.099 },
    { open: 1.1, high: 1.106, low: 1.0995, close: 1.105 },
  ]),
});

/** No touch until 10:00Z — 30 minutes past TIF expiry — then a touch. */
export const postTifTouch: MarketFixture = defineFixture({
  id: "replay/post-tif-touch",
  provenance: {
    ...BASE_PROVENANCE,
    candleRange: { from: DETECTED_AT, to: "2026-08-20T10:15:00.000Z" },
    knownDefects: ["fill-checked-before-tif-deadline"],
  },
  candles: m15Series(DETECTED_AT, [
    // Two bars that never reach the limit but are still inside TIF.
    { open: 1.102, high: 1.1035, low: 1.1005, close: 1.103 },
    { open: 1.103, high: 1.104, low: 1.1015, close: 1.1035 },
    // 09:30Z — bar timestamped at the deadline, still no touch.
    { open: 1.1035, high: 1.1045, low: 1.102, close: 1.104 },
    // 09:45Z — first touch, strictly after TIF expiry.
    { open: 1.104, high: 1.1045, low: 1.0999, close: 1.1005 },
    { open: 1.1005, high: 1.106, low: 1.1, close: 1.1055 },
  ]),
});

/** Filled, then neither barrier for 24h — the vertical barrier resolves it. */
export const verticalExpiry: MarketFixture = defineFixture({
  id: "replay/vertical-expiry",
  provenance: {
    ...BASE_PROVENANCE,
    candleRange: { from: DETECTED_AT, to: "2026-08-21T09:00:00.000Z" },
    knownDefects: [],
  },
  candles: [
    // Fill bar.
    { time: DETECTED_AT, open: 1.1005, high: 1.1015, low: 1.0999, close: 1.101 },
    // Drift bar well inside both barriers.
    { time: "2026-08-20T09:15:00.000Z", open: 1.101, high: 1.1015, low: 1.0985, close: 1.101 },
    // Exactly 24h after detection: vertical barrier.
    { time: "2026-08-21T09:00:00.000Z", open: 1.101, high: 1.1035, low: 1.0985, close: 1.102 },
  ],
});

/** Never touched inside TIF, and the next bar is past the deadline. */
export const neverFilled: MarketFixture = defineFixture({
  id: "replay/never-filled",
  provenance: {
    ...BASE_PROVENANCE,
    candleRange: { from: DETECTED_AT, to: "2026-08-20T09:45:00.000Z" },
    knownDefects: ["miss-distance-only-recorded-on-tif-path"],
  },
  candles: m15Series(DETECTED_AT, [
    { open: 1.102, high: 1.103, low: 1.1015, close: 1.1025 },
    { open: 1.1025, high: 1.1035, low: 1.102, close: 1.103 },
    { open: 1.103, high: 1.1035, low: 1.1024, close: 1.103 },
    // 09:45Z — past TIF, still no touch → never_filled.
    { open: 1.103, high: 1.104, low: 1.1028, close: 1.1035 },
  ]),
});

export const ALL_REPLAY_FIXTURES: MarketFixture[] = [
  sameCandleAllBarriers,
  gapThroughLimit,
  postTifTouch,
  verticalExpiry,
  neverFilled,
];
