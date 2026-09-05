/**
 * Filter lift — decidability of a gate (pure).
 *
 * `filter_lift_stats` holds one row per gate and arm: the PASS arm is what V1
 * published, the FAIL arm is what V1 rejected. Both arms are replayed under the
 * SAME frozen research ladder, so their mean R is comparable.
 *
 * This module never decides policy. It answers only: given the two arms as
 * stored, is the difference readable at all, and in which direction? A gate is
 * decidable only when both arms are reportable, each clears the SHARED
 * descriptive tier on samples AND independent clusters, the two intervals do not
 * overlap, and the difference survives multiplicity control across the bounded,
 * predeclared family of gates. Everything else is labelled "not yet decidable"
 * together with what is still missing — a thin cohort is never rounded up into a
 * recommendation.
 *
 * Interval provenance: the interval is built from the cluster-robust `se_r` the
 * database computed over whole-UTC-day clusters. Nothing here derives an
 * interval from raw means, and an arm without a recorded cluster count is not
 * reportable.
 */
import { benjaminiHochberg, UndeclaredFamilyError, type Hypothesis } from "@/lib/stats/bh";
import { EVIDENCE_TIERS } from "@/lib/stats/evidence";

/** The bar this surface names. Not a local number. */
const LIFT_TIER = EVIDENCE_TIERS.descriptive;

/** Minimum matured, used samples an arm needs before it may be compared. */
export const MIN_ARM_SAMPLES = LIFT_TIER.minSamples;
/** Minimum independent UTC-day clusters an arm needs before it may be compared. */
export const MIN_ARM_CLUSTERS = LIFT_TIER.minClusters;
/** 95% interval multiplier on the cluster-robust standard error. */
const Z = 1.96;
/** False-discovery-rate ceiling for the gate family. */
export const MAX_Q_VALUE = 0.05;

/**
 * The bounded, predeclared family of gates. BH is meaningless over a rolling
 * family, so a gate that is not declared here is reported as not decidable
 * rather than tested.
 */
export const DECLARED_LIFT_GATES = [
  "abc_structure",
  "candles_present",
  "grade",
  "headroom",
  "m15_direction",
  "reachable_r",
  "risk_ceiling",
  "risk_defined",
] as const;

export const LIFT_FAMILY_KEY = "filter_lift_gate_family_v1";

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
  cluster_n?: number | null;
  stat_status: string | null;
  reason: string | null;
  replay_coverage: number | null;
}

export interface FilterLiftArm {
  arm: "pass" | "fail";
  meanR: number | null;
  seR: number | null;
  low: number | null;
  high: number | null;
  nUsed: number;
  nMature: number;
  nCandidates: number;
  clusterN: number;
  reportable: boolean;
  reason: string | null;
  /** Samples still needed before this arm can be compared. */
  missingSamples: number;
  /** Independent day clusters still needed before this arm can be compared. */
  missingClusters: number;
}

export type FilterLiftVerdict =
  "loosening_supported" | "gate_supported" | "no_difference" | "not_yet_decidable";

export interface FilterLiftGate {
  gate: string;
  pass: FilterLiftArm | null;
  fail: FilterLiftArm | null;
  verdict: FilterLiftVerdict;
  /** Plain-language reason, always populated. */
  detail: string;
  /** Mean-R difference (fail minus pass) when both arms are readable. */
  deltaR: number | null;
  /** BH q-value within the declared gate family; null when not testable. */
  qValue: number | null;
}

const EMPTY_ARM = (arm: "pass" | "fail"): FilterLiftArm => ({
  arm,
  meanR: null,
  seR: null,
  low: null,
  high: null,
  nUsed: 0,
  nMature: 0,
  nCandidates: 0,
  clusterN: 0,
  reportable: false,
  reason: "no rows recorded for this arm",
  missingSamples: MIN_ARM_SAMPLES,
  missingClusters: MIN_ARM_CLUSTERS,
});

function toArm(arm: "pass" | "fail", row: FilterLiftRow | undefined): FilterLiftArm | null {
  if (!row) return null;
  const nUsed = Number(row.n_used ?? 0);
  const clusterN = Number(row.cluster_n ?? 0);
  const mean = row.mean_r === null || row.mean_r === undefined ? null : Number(row.mean_r);
  const se = row.se_r === null || row.se_r === undefined ? null : Number(row.se_r);
  const statusOk = row.stat_status === REPORTABLE_STAT_STATUS;
  const enough = nUsed >= MIN_ARM_SAMPLES && clusterN >= MIN_ARM_CLUSTERS;
  const hasInterval = mean !== null && se !== null && Number.isFinite(mean) && Number.isFinite(se);
  return {
    arm,
    meanR: statusOk && mean !== null && Number.isFinite(mean) ? mean : null,
    seR: statusOk && hasInterval ? se : null,
    low: statusOk && enough && hasInterval ? mean! - Z * se! : null,
    high: statusOk && enough && hasInterval ? mean! + Z * se! : null,
    nUsed,
    nMature: Number(row.n_mature ?? 0),
    nCandidates: Number(row.n_candidates ?? 0),
    clusterN,
    reportable: statusOk && enough && hasInterval,
    reason: row.reason ?? null,
    missingSamples: Math.max(0, MIN_ARM_SAMPLES - nUsed),
    missingClusters: Math.max(0, MIN_ARM_CLUSTERS - clusterN),
  };
}

/** Two-sided normal p-value for the arm difference; null when not computable. */
function deltaPValue(pass: FilterLiftArm, fail: FilterLiftArm): number | null {
  if (pass.meanR === null || fail.meanR === null) return null;
  if (pass.seR === null || fail.seR === null) return null;
  const se = Math.hypot(pass.seR, fail.seR);
  if (!Number.isFinite(se) || se <= 0) return null;
  const z = Math.abs(fail.meanR - pass.meanR) / se;
  return 2 * (1 - normalCdf(z));
}

/** Abramowitz-Stegun 7.1.26 error function — deterministic, no dependencies. */
function normalCdf(z: number): number {
  const x = z / Math.SQRT2;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return 0.5 * (1 + sign * y);
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

  const arms = new Map<string, { pass: FilterLiftArm; fail: FilterLiftArm }>();
  for (const [gate, bucket] of gates) {
    arms.set(gate, {
      pass: toArm("pass", bucket.pass) ?? EMPTY_ARM("pass"),
      fail: toArm("fail", bucket.fail) ?? EMPTY_ARM("fail"),
    });
  }

  // Multiplicity control over the bounded, predeclared family. Only gates whose
  // BOTH arms are reportable and which are declared can be tested at all.
  const tested: Hypothesis[] = [];
  for (const [gate, { pass, fail }] of arms) {
    if (!DECLARED_LIFT_GATES.includes(gate as (typeof DECLARED_LIFT_GATES)[number])) continue;
    if (!pass.reportable || !fail.reportable) continue;
    const p = deltaPValue(pass, fail);
    if (p === null) continue;
    tested.push({ key: gate, pValue: p });
  }
  const qByGate = new Map<string, number>();
  if (tested.length > 0) {
    try {
      const bh = benjaminiHochberg(
        {
          familyKey: LIFT_FAMILY_KEY,
          declaredKeys: [...DECLARED_LIFT_GATES],
          experimentId: LIFT_FAMILY_KEY,
        },
        tested,
      );
      for (const r of bh.results) qByGate.set(r.key, r.qValue);
    } catch (err) {
      // A family violation must withhold every verdict, never authorise one.
      if (!(err instanceof UndeclaredFamilyError)) throw err;
      console.error("[filter-lift] multiplicity family rejected:", err.message);
    }
  }

  return [...arms.entries()]
    .map(([gate, { pass, fail }]): FilterLiftGate => {
      if (!pass.reportable || !fail.reportable) {
        const missing: string[] = [];
        for (const [label, arm] of [
          ["published", pass],
          ["rejected", fail],
        ] as const) {
          if (arm.reportable) continue;
          if (arm.missingSamples > 0) {
            missing.push(`${label} arm needs ${arm.missingSamples} more matured samples`);
          } else if (arm.missingClusters > 0) {
            missing.push(`${label} arm needs ${arm.missingClusters} more independent trading days`);
          } else {
            missing.push(`${label} arm not reportable${arm.reason ? ` (${arm.reason})` : ""}`);
          }
        }
        return {
          gate,
          pass,
          fail,
          verdict: "not_yet_decidable",
          detail: missing.join("; "),
          deltaR: null,
          qValue: null,
        };
      }

      const deltaR = fail.meanR! - pass.meanR!;
      const qValue = qByGate.get(gate) ?? null;

      if (!DECLARED_LIFT_GATES.includes(gate as (typeof DECLARED_LIFT_GATES)[number])) {
        return {
          gate,
          pass,
          fail,
          verdict: "not_yet_decidable",
          detail:
            "this gate is not predeclared in the tested family, so no false-discovery control applies — no direction is read",
          deltaR,
          qValue: null,
        };
      }

      const separated = fail.low! > pass.high! || pass.low! > fail.high!;
      const survivesMultiplicity = qValue !== null && qValue <= MAX_Q_VALUE;

      if (separated && !survivesMultiplicity) {
        return {
          gate,
          pass,
          fail,
          verdict: "not_yet_decidable",
          detail:
            qValue === null
              ? "the intervals separate but no false-discovery q-value could be computed — no direction is read"
              : `the intervals separate but the difference does not survive false-discovery control across the ${DECLARED_LIFT_GATES.length} tested gates (q = ${qValue.toFixed(3)})`,
          deltaR,
          qValue,
        };
      }

      if (separated && fail.low! > pass.high!) {
        return {
          gate,
          pass,
          fail,
          verdict: "loosening_supported",
          detail: `rejected setups replayed ${deltaR.toFixed(2)}R better than published ones, the intervals do not overlap and the difference survives false-discovery control (q = ${qValue!.toFixed(3)}) — loosening this gate is supported by the evidence, pending your approval`,
          deltaR,
          qValue,
        };
      }
      if (separated) {
        return {
          gate,
          pass,
          fail,
          verdict: "gate_supported",
          detail: `published setups replayed ${Math.abs(deltaR).toFixed(2)}R better than rejected ones, the intervals do not overlap and the difference survives false-discovery control (q = ${qValue!.toFixed(3)}) — the gate is earning its keep`,
          deltaR,
          qValue,
        };
      }
      return {
        gate,
        pass,
        fail,
        verdict: "no_difference",
        detail: "the two arms' confidence intervals overlap — no difference is readable yet",
        deltaR,
        qValue,
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
