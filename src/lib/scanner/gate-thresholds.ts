/**
 * Owner-approved gate threshold overrides (pure helpers).
 *
 * The three numeric V1 gates — risk ceiling, headroom, reachable R — keep
 * their compiled-in defaults until a `gate_change_proposals` row is approved
 * through `decide_gate_change()`, which writes `gate_threshold_overrides`.
 * Nothing else may change an effective threshold: no env var, no request
 * parameter, no silent edit.
 *
 * Provenance rule: when an override is active the evaluation no longer runs
 * the pinned V1 parameter set, so candidate rows must carry a manifest hash
 * that SAYS so. `effectiveManifestHash()` derives that identity
 * deterministically from the base manifest plus the override map; with no
 * overrides it returns the unchanged pinned hash, so an untouched deployment
 * keeps its historical population.
 */
import { STRATEGY_V1_MANIFEST_HASH } from "@/lib/scanner/strategy-manifest";
import { stableHash } from "@/lib/scanner/v2/manifest";
import type { GateThresholds } from "@/lib/scanner/profile";

export type { GateThresholds };

/** Gates that may ever be overridden. Structural gates are not tunable. */
export const TUNABLE_GATES = ["risk_ceiling", "headroom", "reachable_r"] as const;
export type TunableGate = (typeof TUNABLE_GATES)[number];

export function hasOverrides(t: GateThresholds): boolean {
  return t.minHeadroomAtr != null || t.maxRiskAtr != null || t.minReachableR != null;
}

/**
 * Manifest identity for the effective parameter set. Deterministic, so every
 * row evaluated under the same overrides shares one hash, and the filter-lift
 * aggregation (grouped by manifest_hash) keeps the pre- and post-change
 * populations separate instead of silently mixing them.
 */
export function effectiveManifestHash(t: GateThresholds): string {
  if (!hasOverrides(t)) return STRATEGY_V1_MANIFEST_HASH;
  return stableHash({ base: STRATEGY_V1_MANIFEST_HASH, gateThresholds: t });
}
