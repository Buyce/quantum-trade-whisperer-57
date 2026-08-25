/**
 * Asset-class strategy manifests (Wave 2) — DEFINED, DELIBERATELY NOT WIRED.
 *
 * The V1/V2/V3 strategy code was written against FX and gold. Its assumptions are
 * not universal, and the honest response to a new asset class is to say which
 * assumptions have been checked rather than to run the FX model and call the output
 * a signal. This module records that audit as data.
 *
 * NOTHING here is consulted by the scanner in this pass. A manifest becomes
 * effective only when its instrument legitimately reaches `shadow`, and Wave 0/Wave
 * 1 behaviour is unchanged because `fx` and `metal` manifests describe exactly what
 * the code already does.
 */
import type { AssetClass } from "@/lib/instruments/registry";

/** Bump when the manifest CONTENT changes meaning, so evidence stays comparable. */
export const ASSET_MANIFEST_VERSION = 1 as const;

export type PortabilityStatus =
  /** Verified against Wave 0/Wave 1 evidence; behaviour is what production does. */
  | "verified"
  /** Plausible but unmeasured for this asset class; must be measured in shadow. */
  | "unverified"
  /** Known to be wrong for this asset class; must be replaced before shadow. */
  | "invalid";

export interface AssumptionAudit {
  assumption: string;
  status: PortabilityStatus;
  note: string;
}

export interface AssetStrategyManifest {
  assetClass: AssetClass;
  version: typeof ASSET_MANIFEST_VERSION;
  /** True only when every assumption is `verified`. */
  readyForShadow: boolean;
  assumptions: AssumptionAudit[];
}

function manifest(assetClass: AssetClass, assumptions: AssumptionAudit[]): AssetStrategyManifest {
  return {
    assetClass,
    version: ASSET_MANIFEST_VERSION,
    readyForShadow: assumptions.every((a) => a.status === "verified"),
    assumptions,
  };
}

const FX_VERIFIED: AssumptionAudit[] = [
  { assumption: "abc_structure_detection", status: "verified", note: "Wave 0 production model." },
  { assumption: "atr_period_and_timeframes", status: "verified", note: "H4/H1/M15 as shipped." },
  { assumption: "stop_buffer_from_spread_floor", status: "verified", note: "Measured floors." },
  { assumption: "entry_offset_session_aware", status: "verified", note: "Session model is FX." },
  { assumption: "gap_handling", status: "verified", note: "Weekend gap only; no daily break." },
  { assumption: "volatility_class_boundaries", status: "verified", note: "Frozen definitions." },
  { assumption: "cooldown_and_daily_cap", status: "verified", note: "Unchanged semantics." },
];

export const ASSET_STRATEGY_MANIFESTS: readonly AssetStrategyManifest[] = [
  manifest("fx", FX_VERIFIED),
  manifest(
    "metal",
    FX_VERIFIED.map((a) =>
      a.assumption === "stop_buffer_from_spread_floor"
        ? { ...a, note: "XAUUSD floor measured; XAGUSD has none yet." }
        : a,
    ),
  ),
  manifest("energy", [
    {
      assumption: "abc_structure_detection",
      status: "unverified",
      note: "Crude trends and reverses on inventory prints; swing geometry is unmeasured here.",
    },
    {
      assumption: "atr_period_and_timeframes",
      status: "unverified",
      note: "Energy volatility clusters around settlement; the FX ATR period is unproven.",
    },
    {
      assumption: "stop_buffer_from_spread_floor",
      status: "invalid",
      note: "No measured floor and no broker point on record; a stop distance cannot be derived.",
    },
    {
      assumption: "entry_offset_session_aware",
      status: "invalid",
      note: "The session model is FX-only and has no settlement break.",
    },
    {
      assumption: "gap_handling",
      status: "invalid",
      note: "A daily maintenance break produces intraday gaps the FX path does not expect.",
    },
    {
      assumption: "volatility_class_boundaries",
      status: "unverified",
      note: "Boundaries were fitted on FX/gold ranges.",
    },
    {
      assumption: "cooldown_and_daily_cap",
      status: "unverified",
      note: "Cap semantics carry over, but correlated WTI/Brent duplication does not.",
    },
  ]),
  manifest("index", [
    {
      assumption: "abc_structure_detection",
      status: "unverified",
      note: "Index CFDs trend through cash-session opens; structure identity is unmeasured.",
    },
    {
      assumption: "atr_period_and_timeframes",
      status: "unverified",
      note: "Overnight vs cash-session volatility differ sharply.",
    },
    {
      assumption: "stop_buffer_from_spread_floor",
      status: "invalid",
      note: "Index points are not pips; no floor and no broker grid on record.",
    },
    {
      assumption: "entry_offset_session_aware",
      status: "invalid",
      note: "Requires cash-session awareness the FX session model does not have.",
    },
    { assumption: "gap_handling", status: "invalid", note: "Daily break plus cash-open gaps." },
    {
      assumption: "volatility_class_boundaries",
      status: "unverified",
      note: "Index ranges are an order of magnitude away from FX ranges.",
    },
    {
      assumption: "cooldown_and_daily_cap",
      status: "unverified",
      note: "Carries over structurally; unmeasured for index cadence.",
    },
  ]),
];

const BY_CLASS = new Map(ASSET_STRATEGY_MANIFESTS.map((m) => [m.assetClass, m]));

export function assetManifest(assetClass: AssetClass): AssetStrategyManifest | undefined {
  return BY_CLASS.get(assetClass);
}

/** Blockers that must be cleared before an asset class may run strategy code. */
export function shadowBlockers(assetClass: AssetClass): string[] {
  const m = BY_CLASS.get(assetClass);
  if (!m) return [`no strategy manifest for asset class ${assetClass}`];
  return m.assumptions
    .filter((a) => a.status !== "verified")
    .map((a) => `${a.assumption} (${a.status}): ${a.note}`);
}
