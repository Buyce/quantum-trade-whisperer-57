/**
 * Immutable provenance for the PRODUCTION (V1) evaluation strategy.
 *
 * Research candidates are only poolable when they were produced by the same
 * evaluator under the same parameters. `strategy_version` is the human-facing
 * lineage number; `STRATEGY_V1_MANIFEST_HASH` is the machine check. Change a
 * threshold below and the hash changes, so a later analysis cannot silently
 * average two different strategies together.
 *
 * The gate order is part of the manifest on purpose: a candidate labelled
 * `no_headroom` only means the same thing if headroom was evaluated at the same
 * point in the sequence.
 */
import {
  DEFAULT_SPREAD_FLOOR,
  DYNAMIC_ENTRY_ATR_FRACTION,
  MAX_RISK_ATR,
  MIN_DYNAMIC_RISK_ATR,
  MIN_REACHABLE_R,
  RUNAWAY_SESSIONS,
  SLIPPAGE_TOLERANCE_R,
  SPREAD_FLOOR,
  STOP_H1_ATR_FLOOR,
  STOP_M15_ATR_MULTIPLIER,
  TIGHT_SLIPPAGE_TOLERANCE_R,
} from "./types";
import { stableHash } from "./v2/manifest";

export const STRATEGY_V1_VERSION = 1 as const;
export const STRATEGY_V1_LABEL = "v1-production-abc" as const;

export const STRATEGY_V1_PARAMS = {
  gateOrder: [
    "candles_present",
    "m15_direction",
    "grade",
    "abc_structure",
    "risk_defined",
    "risk_ceiling",
    "headroom",
    "reachable_r",
  ],
  stop: {
    m15AtrMultiplier: STOP_M15_ATR_MULTIPLIER,
    h1AtrFloor: STOP_H1_ATR_FLOOR,
    spreadFloor: SPREAD_FLOOR,
    defaultSpreadFloor: DEFAULT_SPREAD_FLOOR,
    structuralExtremeLookback: 10,
  },
  risk: {
    maxRiskAtr: MAX_RISK_ATR,
    minReachableR: MIN_REACHABLE_R,
    slippageToleranceR: SLIPPAGE_TOLERANCE_R,
    tightSlippageToleranceR: TIGHT_SLIPPAGE_TOLERANCE_R,
  },
  entry: {
    structural: "ABC point C",
    dynamicSessions: RUNAWAY_SESSIONS,
    dynamicAtrFraction: DYNAMIC_ENTRY_ATR_FRACTION,
    minDynamicRiskAtr: MIN_DYNAMIC_RISK_ATR,
  },
} as const;

export const STRATEGY_V1_MANIFEST_HASH = stableHash(STRATEGY_V1_PARAMS);
