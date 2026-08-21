/**
 * Immutable provenance for research model version 3.
 *
 * V3 is the geometry-correction research cohort. Every V3 observation and shadow
 * row is stamped `model_version = 3`; this manifest is what that number MEANS,
 * and it is registered in `public.model_versions` before V3 evaluation is
 * enabled so a snapshot taken months later can be reproduced exactly.
 *
 * The hash is a deterministic FNV-1a/64 digest of the canonical parameter set
 * below (reusing V2's `stableHash`), NOT a git SHA: parameters are what change
 * model behaviour, and a pure function keeps this module importable from both
 * the Worker runtime and the test suite.
 */
import {
  MAX_RISK_ATR,
  MIN_REACHABLE_R,
  STOP_H1_ATR_FLOOR,
  STOP_M15_ATR_MULTIPLIER,
} from "../types";
import { RETRACEMENT_MAX, RETRACEMENT_MIN, PIVOT_LOOKBACK } from "../v2/pointc";
import {
  H4_PIVOT_LOOKBACK,
  OPEN_SPACE_EXTENSION_ATR,
  PIVOT_MIN_SEPARATION_ATR,
} from "../v2/barrier";
import { ZONE_MAX_DISTANCE_ATR } from "../v2/pillars";
import { VOLATILITY_V2_PARAMS } from "../v2/volatility";
import { stableHash } from "../v2/manifest";
import { V3_SLIPPAGE_PARAMS } from "./slippage";
import { V3_STOP_PARAMS } from "./stop";

export const MODEL_V3_VERSION = 3 as const;
export const MODEL_V3_LABEL = "v3-corrected-geometry-research" as const;

export const MODEL_V3_PARAMS = {
  /** Inherited from V2 verbatim — same canonical ABC detection. */
  pointC: {
    retracementMin: RETRACEMENT_MIN,
    retracementMax: RETRACEMENT_MAX,
    pivotLookback: PIVOT_LOOKBACK,
    selection: "most-recent-B, nearest-preceding-A, single deterministic pass",
    inheritedFrom: "v2",
  },
  /** Inherited from V2 verbatim — one barrier for grade headroom AND the R cascade. */
  barrier: {
    h4PivotLookback: H4_PIVOT_LOOKBACK,
    pivotMinSeparationAtr: PIVOT_MIN_SEPARATION_ATR,
    openSpaceExtensionAtr: OPEN_SPACE_EXTENSION_ATR,
    usage: "single barrier for both grade headroom and the R cascade",
    inheritedFrom: "v2",
  },
  /** Inherited from V2 verbatim. */
  pillars: {
    zoneMaxDistanceAtr: ZONE_MAX_DISTANCE_ATR,
    zoneNormalisation: "native-timeframe Wilder ATR at the zone bar (prefix-only)",
    volatility: VOLATILITY_V2_PARAMS,
    inheritedFrom: "v2",
  },
  /** V3 correction 1: the stop is scoped to the retracement leg. */
  stop: V3_STOP_PARAMS,
  /** V3 correction 2: entry is structural only — no session-based offset. */
  entry: {
    rule: "structural-entry-only: the canonical Point C price, exactly",
    dynamicOffset: "disabled — V3 never shifts the limit off Point C",
  },
  /** V3 correction 3: the slippage ceiling preserves the graded payoff. */
  slippage: V3_SLIPPAGE_PARAMS,
  /** Inherited from V1/V2 verbatim. */
  risk: {
    maxRiskAtr: MAX_RISK_ATR,
    minReachableR: MIN_REACHABLE_R,
    stopM15AtrMultiplier: STOP_M15_ATR_MULTIPLIER,
    stopH1AtrFloor: STOP_H1_ATR_FLOOR,
    inheritedFrom: "v1",
  },
  /** Inherited from V1/V2 verbatim. */
  targetLadder: {
    full: "maxR >= 3 => [1, 2, 3]",
    mid: "1.5 <= maxR < 3 => [0.5, 0.75, 1.0] x maxR",
    thin: "maxR < 1.5 => [0.6, 1.0] x maxR, TP3 null",
    inheritedFrom: "v1",
  },
  policy: {
    published: false,
    shadowEnrolled: "continuation family only, gated by shadow_engine_state.v3_enabled",
    meanReversion: "observation only",
    candleSnapshot: "identical MetaApi snapshot as V1, forming bar included",
    formingCandleAssumption:
      "the last M15 bar is in progress and is evaluated as-is, exactly as V1/V2 do",
    priors: "never contributes to regime_stats or any live prior",
  },
} as const;

export const MODEL_V3_CODE_HASH = stableHash(MODEL_V3_PARAMS);
