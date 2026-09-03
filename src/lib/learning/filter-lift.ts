/**
 * Filter lift — decidability of a gate (pure).
 *
 * `filter_lift_stats` holds one row per gate and arm: the PASS arm is what V1
 * published, the FAIL arm is what V1 rejected. Both arms are replayed under the
 * SAME frozen research ladder, so their mean R is comparable.
 *
 * This module never decides policy. It answers only: given the two arms as
 * stored, is the difference readable at all, and in which direction? A gate is
 * decidable only when both arms are reportable, each carries enough samples, and
 * the two confidence intervals do not overlap. Everything else is labelled
 * "not yet decidable" together with how many samples are still missing —
 * a thin cohort is never rounded up into a recommendation.
 */

/** Minimum matured, used samples an arm needs before it may be compared. */
export const MIN_ARM_SAMPLES = 30;
/** 95% normal interval multiplier. */
const Z = 1.96;

/** The only `stat_status` value whose numbers may be read as a result. */
export const REPORTABLE_STAT_STATUS = "descriptive";

export interface FilterLiftRow {
  gate: string;
  arm: string;
  mean_r: number | null;
  se_r: number | null;
  n_used: number | null;
  n_mature: number | null;
  n_resolved: number | null;
  n_candidates: number | null;
  stat_status: string | null;
  reason: string | null;
  replay_coverage: number | null;
}

export interface FilterLiftArm {
  arm: "pass" | "fail";
  meanR: number | null;
  low: number | null;
  high: number | null;
  nUsed: number;
  nMature: number;
  nCandidates: number;
  reportable: boolean;
  reason: string | null;
  /** Samples still needed before this arm can be compared. */
  missingSamples: number;
}

export type FilterLiftVerdict =
  | "loosening_supported"
  | "gate_supported"
  | "no_difference"
  | "not_yet_decidable";

export interface FilterLiftGate {
  gate: string;
  pass: FilterLiftArm | null;
  fail: FilterLiftArm | null;
  verdict: FilterLiftVerdict;
  /** Plain-language reason, always populated. */
  detail: string;
  /** Mean-R difference (fail minus pass) when both arms are readable. */
  deltaR: number | null;
}

const EMPTY_ARM = (arm: "pass" | "fail"): FilterLiftArm => ({
  arm,
  meanR: null,
  low: null,
  high: null,
  nUsed: 0,
  nMature: 0,
  nCandidates: 0,
  reportable: false,
  reason: "no rows recorded for this arm",
  missingSamples: MIN_ARM_SAMPLES,
});

function toArm(arm: "pass" | "fail", row: FilterLiftRow | undefined): FilterLiftArm | null {
  if (!row) return null;
  const nUsed = Number(row.n_used ?? 0);
  const mean = row.mean_r === null || row.mean_r === undefined ? null : Number(row.mean_r);
  const se = row.se_r === null || row.se_r === undefined ? null : Number(row.se_r);
  const statusOk = row.stat_status === REPORTABLE_STAT_STATUS;
  const enough = nUsed >= MIN_ARM_SAMPLES;
  const hasInterval = mean !== null && se !== null && Number.isFinite(mean) && Number.isFinite(se);
  return {
    arm,
    meanR: statusOk && mean !== null && Number.isFinite(mean) ? mean : null,
    low: statusOk && enough && hasInterval ? mean! - Z * se! : null,
    high: statusOk && enough && hasInterval ? mean! + Z * se! : null,
    nUsed,
    nMature: Number(row.n_mature ?? 0),
    nCandidates: Number(row.n_candidates ?? 0),
    reportable: statusOk && enough && hasInterval,
    reason: row.reason ?? null,
    missingSamples: Math.max(0, MIN_ARM_SAMPLES - nUsed),
  };
}

/** Groups the stored rows into one decidability verdict per gate. */
export function summarizeFilterLift(rows: FilterLiftRow[]): FilterLiftGate[] {
  const gates = new Map<string, { pass?: FilterLiftRow; fail?: FilterLiftRow }>();
  for (const row of rows) {
    const bucket = gates.get(row.gate) ?? {};
    if (row.arm === "pass") bucket.pass = row;
    if (row.arm === "fail") bucket.fail = row;
    gates.set(row.gate, bucket);
  }

  return [...gates.entries()]
    .map(([gate, bucket]) => {
      const pass = toArm("pass", bucket.pass) ?? EMPTY_ARM("pass");
      const fail = toArm("fail", bucket.fail) ?? EMPTY_ARM("fail");

      if (!pass.reportable || !fail.reportable) {
        const missing: string[] = [];
        if (!pass.reportable) {
          missing.push(
            pass.missingSamples > 0
              ? `published arm needs ${pass.missingSamples} more matured samples`
              : `published arm not reportable${pass.reason ? ` (${pass.reason})` : ""}`,
          );
        }
        if (!fail.reportable) {
          missing.push(
            fail.missingSamples > 0
              ? `rejected arm needs ${fail.missingSamples} more matured samples`
              : `rejected arm not reportable${fail.reason ? ` (${fail.reason})` : ""}`,
          );
        }
        return {
          gate,
          pass,
          fail,
          verdict: "not_yet_decidable" as const,
          detail: missing.join("; "),
          deltaR: null,
        };
      }

      const deltaR = fail.meanR! - pass.meanR!;
      if (fail.low! > pass.high!) {
        return {
          gate,
          pass,
          fail,
          verdict: "loosening_supported" as const,
          detail: `rejected setups replayed ${deltaR.toFixed(2)}R better than published ones and the intervals do not overlap — loosening this gate is supported by the evidence, pending your approval`,
          deltaR,
        };
      }
      if (pass.low! > fail.high!) {
        return {
          gate,
          pass,
          fail,
          verdict: "gate_supported" as const,
          detail: `published setups replayed ${Math.abs(deltaR).toFixed(2)}R better than rejected ones and the intervals do not overlap — the gate is earning its keep`,
          deltaR,
        };
      }
      return {
        gate,
        pass,
        fail,
        verdict: "no_difference" as const,
        detail: "the two arms' confidence intervals overlap — no difference is readable yet",
        deltaR,
      };
    })
    .sort((a, b) => a.gate.localeCompare(b.gate));
}

export const VERDICT_LABELS: Record<FilterLiftVerdict, string> = {
  loosening_supported: "Loosening supported",
  gate_supported: "Gate supported",
  no_difference: "No difference readable",
  not_yet_decidable: "Not yet decidable",
};
