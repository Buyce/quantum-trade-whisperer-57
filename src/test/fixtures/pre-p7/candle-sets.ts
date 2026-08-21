/**
 * Deterministic candle scenarios for the pre-Prompt-7 characterization gate.
 *
 * Synthetic and fully reproducible: a fixed 32-bit LCG, no randomness sourced
 * from the runtime, no network, and no broker/MetaApi request of any kind. These
 * arrays are test INPUTS only — nothing here is ever written to the database or
 * shown in the app.
 *
 * The seeds are chosen to span the full evaluation space: aligned trends that
 * publish, neutral chop that terminates at the M15 gate, and mid cases that
 * terminate at grading, risk or headroom.
 */
import type { Candle } from "@/lib/scanner/types";

const INSTRUMENTS = ["EURUSD", "GBPAUD", "XAUUSD"] as const;

/** 32-bit linear congruential generator: identical output on every machine. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function series(
  seed: number,
  count: number,
  stepMinutes: number,
  base: number,
  drift: number,
  vol: number,
  endIso: string,
): Candle[] {
  const rnd = lcg(seed);
  const end = new Date(endIso).getTime();
  const out: Candle[] = [];
  let price = base;
  for (let i = count - 1; i >= 0; i -= 1) {
    const time = new Date(end - i * stepMinutes * 60_000).toISOString();
    const open = price;
    const shock = (rnd() - 0.5) * 2 * vol;
    const close = open + drift + shock;
    const wick = vol * (0.3 + rnd() * 0.7);
    out.push({
      time,
      open: round(open),
      high: round(Math.max(open, close) + wick),
      low: round(Math.min(open, close) - wick),
      close: round(close),
    });
    price = close;
  }
  return out;
}

function round(v: number): number {
  return Number(v.toFixed(5));
}

export interface CandleScenario {
  id: string;
  instrument: string;
  session: string;
  candles: Record<"H4" | "H1" | "M15", Candle[]>;
}

const END = "2026-08-20T12:00:00.000Z";
const SESSIONS = ["london", "newyork", "asia", "sydney"] as const;

/**
 * 36 scenarios: 12 drift/volatility regimes across 3 instruments. Every one is a
 * fixed function of its index, so the fixture count and content cannot drift.
 */
export const CANDLE_SCENARIOS: CandleScenario[] = Array.from({ length: 36 }, (_, i) => {
  const instrument = INSTRUMENTS[i % INSTRUMENTS.length]!;
  const scale = instrument === "XAUUSD" ? 1000 : 1;
  const base = (instrument === "GBPAUD" ? 1.92 : 1.1) * scale;
  const vol = 0.0012 * scale * (1 + (i % 4));
  // Drift cycles through strong up, flat, strong down and weak up regimes.
  const driftCycle = [1.4, 0, -1.4, 0.35, -0.35, 0.9][i % 6]!;
  const drift = 0.0004 * scale * driftCycle;
  const seed = 20260820 + i * 7919;
  return {
    id: `pre-p7-${String(i).padStart(2, "0")}-${instrument}`,
    instrument,
    session: SESSIONS[i % SESSIONS.length]!,
    candles: {
      H4: series(seed + 1, 220, 240, base, drift * 16, vol * 4, END),
      H1: series(seed + 2, 260, 60, base, drift * 4, vol * 2, END),
      M15: series(seed + 3, 320, 15, base, drift, vol, END),
    },
  };
});
