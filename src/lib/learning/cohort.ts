/**
 * Cohort evidence — instrument x direction x session (pure module, no I/O).
 *
 * The live trader currently ignores these dimensions entirely, yet replayed
 * history shows large differences between them. This module measures each cohort
 * with the SAME evidence bar the rest of the platform uses (whole-UTC-day
 * cluster bootstrap, 95% interval, minimum independent clusters) and returns a
 * verdict per cohort.
 *
 * Zero-hallucination rules enforced here:
 *  - Numbers come only from resolved replay outcomes on real candles.
 *  - A cohort below the descriptive floor, or without enough independent day
 *    clusters, is `insufficient`. It is never refused and never promoted on a
 *    thin sample, and its absence of evidence is never reported as evidence.
 *  - Only a cohort whose ENTIRE 95% interval sits below zero is `negative`, and
 *    only a `negative` cohort may be refused. An overlapping interval is
 *    `inconclusive` and changes nothing.
 *  - The hypothesis family is bounded and predeclared (`declaredCohortKeys`), so
 *    this is not a rolling search over an ever-growing set of slices.
 */
import { SESSION_NAMES } from "@/lib/scanner/session";
import {
  clusterBootstrapMeanR,
  type BootstrapResult,
  type RObservation,
} from "@/lib/stats/bootstrap";
import { EVIDENCE_TIERS, tierMet } from "@/lib/stats/evidence";

/** The bar this surface names. Not a local number. */
const COHORT_TIER = EVIDENCE_TIERS.descriptive;

export const COHORT_VERSION = 1;

/** Session bucket used when the context row carried no session. */
export const UNKNOWN_SESSION = "unknown" as const;

export type CohortVerdict = "negative" | "positive" | "inconclusive" | "insufficient";

export interface CohortObservation extends RObservation {
  instrument: string;
  direction: string;
  /** `null` becomes the `unknown` bucket — never dropped, never guessed. */
  session: string | null;
}

export interface CohortEvidence {
  key: string;
  instrument: string;
  direction: string;
  session: string;
  n: number;
  clusterN: number;
  meanR: number | null;
  ciLo: number | null;
  ciHi: number | null;
  verdict: CohortVerdict;
  /** Plain-language reason. Always populated. */
  detail: string;
  bootstrap: BootstrapResult;
}

export function cohortKey(instrument: string, direction: string, session: string | null): string {
  return `${instrument}|${direction}|${session ?? UNKNOWN_SESSION}`;
}

/**
 * The bounded, predeclared family: every cohort key that can ever be tested for
 * the given instruments. Declared up front so the family size never grows with
 * the data.
 */
export function declaredCohortKeys(instruments: readonly string[]): string[] {
  const keys: string[] = [];
  for (const instrument of instruments) {
    for (const direction of ["long", "short"]) {
      for (const session of [...SESSION_NAMES, UNKNOWN_SESSION]) {
        keys.push(cohortKey(instrument, direction, session));
      }
    }
  }
  return keys;
}

export function buildCohortEvidence(
  rows: readonly CohortObservation[],
): Map<string, CohortEvidence> {
  const groups = new Map<string, CohortObservation[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.r)) continue;
    const key = cohortKey(row.instrument, row.direction, row.session);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const out = new Map<string, CohortEvidence>();
  for (const [key, members] of groups) {
    const first = members[0]!;
    const bootstrap = clusterBootstrapMeanR(members);
    const { verdict, detail } = judge(bootstrap, members.length);
    out.set(key, {
      key,
      instrument: first.instrument,
      direction: first.direction,
      session: first.session ?? UNKNOWN_SESSION,
      n: members.length,
      clusterN: bootstrap.clusterN,
      meanR: bootstrap.mean,
      ciLo: bootstrap.ciLo,
      ciHi: bootstrap.ciHi,
      verdict,
      detail,
      bootstrap,
    });
  }
  return out;
}

function judge(bootstrap: BootstrapResult, n: number): { verdict: CohortVerdict; detail: string } {
  if (!tierMet(COHORT_TIER, n, bootstrap.clusterN)) {
    return {
      verdict: "insufficient",
      detail: `needs ${COHORT_TIER.minSamples} matured outcomes across ${COHORT_TIER.minClusters} independent days to read (has ${n} across ${bootstrap.clusterN})`,
    };
  }

  if (bootstrap.status !== "ok" || bootstrap.ciLo == null || bootstrap.ciHi == null) {
    return {
      verdict: "insufficient",
      detail:
        bootstrap.reason ??
        `no cluster-robust interval available (${bootstrap.clusterN} independent days)`,
    };
  }
  if (bootstrap.ciHi < 0) {
    return {
      verdict: "negative",
      detail: `whole 95% interval below zero (${bootstrap.ciLo.toFixed(3)} … ${bootstrap.ciHi.toFixed(3)}R over ${n} outcomes)`,
    };
  }
  if (bootstrap.ciLo > 0) {
    return {
      verdict: "positive",
      detail: `whole 95% interval above zero (${bootstrap.ciLo.toFixed(3)} … ${bootstrap.ciHi.toFixed(3)}R over ${n} outcomes)`,
    };
  }
  return {
    verdict: "inconclusive",
    detail: `95% interval spans zero (${bootstrap.ciLo.toFixed(3)} … ${bootstrap.ciHi.toFixed(3)}R over ${n} outcomes)`,
  };
}

/**
 * Whether a setup's cohort is refused. Only a cohort proven negative refuses;
 * an unmeasured or inconclusive cohort passes untouched.
 */
export function cohortRefused(
  evidence: Map<string, CohortEvidence>,
  instrument: string,
  direction: string,
  session: string | null,
): CohortEvidence | null {
  const hit = evidence.get(cohortKey(instrument, direction, session));
  return hit && hit.verdict === "negative" ? hit : null;
}

/**
 * Ranking score for the daily cap. Only a cohort that cleared the evidence bar
 * contributes a score; everything unmeasured ranks equal so it keeps its
 * chronological position relative to other unmeasured setups.
 */
export function cohortRankScore(
  evidence: Map<string, CohortEvidence>,
  instrument: string,
  direction: string,
  session: string | null,
): number | null {
  const hit = evidence.get(cohortKey(instrument, direction, session));
  if (!hit) return null;
  if (hit.verdict === "insufficient" || hit.verdict === "inconclusive") return null;
  return hit.meanR;
}
