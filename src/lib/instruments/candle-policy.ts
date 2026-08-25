/**
 * Candle policy register (R7) — WHICH BAR a computation was allowed to read.
 *
 * The scanner has always graded using the forming (current, incomplete) candle.
 * That is a real methodological choice with a real consequence: a grade computed
 * from a forming bar can change before that bar closes, so a historical row is
 * only comparable with another row produced under the SAME policy.
 *
 * Phase A2 does not change Wave 0 behaviour. It NAMES it, versions it, and stamps
 * the version onto every row the telemetry layer writes, so a future closed-candle
 * research model can coexist without silently redefining the past.
 *
 * The authoritative list also lives in `public.candle_policies`; this module and
 * that table are pinned to each other by test.
 */

export type CandleFinality = "forming" | "closed";

export interface CandlePolicy {
  version: number;
  name: string;
  finality: CandleFinality;
  /** Which pipeline the policy governs. */
  appliesTo: "wave0_live" | "research";
  description: string;
}

export const CANDLE_POLICIES: CandlePolicy[] = [
  {
    version: 1,
    name: "wave0-forming-current-candle-v1",
    finality: "forming",
    appliesTo: "wave0_live",
    description:
      "Preserved Wave 0 behaviour: indicators and grading may read the current, " +
      "still-forming candle. Grades are therefore provisional until the bar closes.",
  },
  {
    version: 2,
    name: "research-closed-candles-v1",
    finality: "closed",
    appliesTo: "research",
    description:
      "Research/challenger reads only closed candles, so a stored evaluation can " +
      "never be revised by later ticks inside the same bar.",
  },
];

/** The policy the live Wave 0 pipeline runs under. Do NOT change to alter behaviour. */
export const LIVE_CANDLE_POLICY_VERSION = 1 as const;

/** The policy any closed-candle research model must declare. */
export const RESEARCH_CANDLE_POLICY_VERSION = 2 as const;

export function candlePolicy(version: number): CandlePolicy | null {
  return CANDLE_POLICIES.find((p) => p.version === version) ?? null;
}
