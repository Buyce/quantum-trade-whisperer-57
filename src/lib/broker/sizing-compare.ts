/**
 * Dual-run sizing comparison (Prompt 12).
 *
 * Model 1 (static contract table) stays authoritative until the broker-spec
 * model has been observed. This module is the pure comparison used to record
 * what would have changed — it never picks a winner.
 */
import type { RiskResult } from "@/lib/risk";

export interface SizingDivergence {
  diverged: boolean;
  /** v1 lots, or null when v1 produced no size. */
  v1Lots: number | null;
  v2Lots: number | null;
  v1Reason: string | null;
  v2Reason: string | null;
  lotsDelta: number | null;
  riskDelta: number | null;
  /** Human-readable summary for the admin review that precedes promotion. */
  summary: string;
}

function lots(r: RiskResult): number | null {
  return r.ok ? r.lots : null;
}
function reason(r: RiskResult): string | null {
  return r.ok ? null : r.reason;
}

export function compareSizing(v1: RiskResult, v2: RiskResult): SizingDivergence {
  const v1Lots = lots(v1);
  const v2Lots = lots(v2);
  const v1Reason = reason(v1);
  const v2Reason = reason(v2);

  const lotsDelta =
    v1Lots !== null && v2Lots !== null ? Number((v2Lots - v1Lots).toFixed(6)) : null;
  const riskDelta = v1.ok && v2.ok ? Number((v2.riskAmount - v1.riskAmount).toFixed(6)) : null;

  const availabilityChanged = v1.ok !== v2.ok || v1Reason !== v2Reason;
  const sizeChanged = lotsDelta !== null && Math.abs(lotsDelta) > 1e-9;
  const diverged = availabilityChanged || sizeChanged;

  const summary = !diverged
    ? "identical"
    : availabilityChanged
      ? `availability: v1=${v1Reason ?? "ok"} v2=${v2Reason ?? "ok"}`
      : `lots: v1=${v1Lots} v2=${v2Lots}`;

  return { diverged, v1Lots, v2Lots, v1Reason, v2Reason, lotsDelta, riskDelta, summary };
}
