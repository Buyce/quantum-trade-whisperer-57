/**
 * Immutable provenance for research model version 2.
 *
 * Every V2 observation is stamped with `model_version = 2`; this manifest is
 * what that number MEANS. It is registered in `public.model_versions` before V2
 * evaluation is enabled, so a snapshot taken months later can be reproduced.
 *
 * `MODEL_V2_CODE_HASH` is a deterministic FNV-1a/64 digest of the canonical
 * parameter set below. It is intentionally NOT a git SHA: parameters are what
 * change model behaviour, and a pure function keeps this module importable from
 * both the Worker runtime and the test suite with no crypto dependency.
 */
import { RETRACEMENT_MAX, RETRACEMENT_MIN, PIVOT_LOOKBACK } from "./pointc";
import {
  H4_PIVOT_LOOKBACK,
  OPEN_SPACE_EXTENSION_ATR,
  PIVOT_MIN_SEPARATION_ATR,
} from "./barrier";
import { ZONE_MAX_DISTANCE_ATR } from "./pillars";
import { VOLATILITY_V2_PARAMS } from "./volatility";

export const MODEL_V2_VERSION = 2 as const;
export const MODEL_V2_LABEL = "v2-canonical-abc-research" as const;

export const MODEL_V2_PARAMS = {
  pointC: {
    retracementMin: RETRACEMENT_MIN,
    retracementMax: RETRACEMENT_MAX,
    pivotLookback: PIVOT_LOOKBACK,
    selection: "most-recent-B, nearest-preceding-A, single deterministic pass",
  },
  barrier: {
    h4PivotLookback: H4_PIVOT_LOOKBACK,
    pivotMinSeparationAtr: PIVOT_MIN_SEPARATION_ATR,
    openSpaceExtensionAtr: OPEN_SPACE_EXTENSION_ATR,
    usage: "single barrier for both grade headroom and the R cascade",
  },
  pillars: {
    zoneMaxDistanceAtr: ZONE_MAX_DISTANCE_ATR,
    zoneNormalisation: "native-timeframe Wilder ATR at the zone bar (prefix-only)",
    volatility: VOLATILITY_V2_PARAMS,
  },
  policy: {
    published: false,
    shadowEnrolled: "continuation family only",
    meanReversion: "observation only",
    candleSnapshot: "identical MetaApi snapshot as V1, forming bar included",
  },
} as const;

/** Deterministic 64-bit FNV-1a digest of a canonically stringified value. */
export function stableHash(value: unknown): string {
  const json = canonicalJson(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < json.length; i += 1) {
    hash = (hash ^ BigInt(json.charCodeAt(i))) & mask;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export const MODEL_V2_CODE_HASH = stableHash(MODEL_V2_PARAMS);
