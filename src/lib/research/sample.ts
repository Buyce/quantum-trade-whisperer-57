/**
 * Prompt 14 Stage 5 (pre-flight 5) — sample size for pooled broker evidence.
 *
 * The single easiest way to fabricate statistical confidence in this product is
 * to count customer executions as independent observations. They are not: if one
 * hundred customers all take the SAME published setup, the strategy was right or
 * wrong exactly once. Reporting n = 100 would overstate precision by a factor of
 * ten.
 *
 * Two populations therefore exist and are counted separately, forever:
 *
 *  1. STRATEGY EDGE — collapse by `signal_id`. One published setup contributes
 *     one observation, no matter how many accounts executed it.
 *  2. EXECUTION QUALITY — every execution counts. Slippage, fill rate and cost
 *     are properties of an execution, not of the setup, so 100 executions are
 *     genuinely 100 observations here.
 *
 * The whole-UTC-day clustering used by the Prompt-9 bootstrap is preserved: the
 * collapsed strategy-edge rows keep the UTC day they were detected in, so the
 * day remains the resampling unit.
 *
 * Pure: no I/O.
 */

export interface BrokerEvidenceObservation {
  signalId: string;
  /** Pseudonymous research reference — never a user id or a broker login. */
  researchRef: string;
  /** ISO instant used to derive the UTC clustering day. */
  detectedAt: string;
  rVsPlan: number | null;
  rVsActualRisk: number | null;
  slippage: number | null;
  filled: boolean;
}

export interface SignalEdgeObservation {
  signalId: string;
  utcDay: string;
  /** Executions that contributed to this one collapsed observation. */
  executions: number;
  /** Distinct accounts, as pseudonymous refs, that executed the setup. */
  accounts: number;
  /** Median R vs plan across the executions of this ONE setup. */
  rVsPlan: number | null;
}

export interface CollapsedSample {
  signalEdge: SignalEdgeObservation[];
  /** Independent observations available for a strategy-edge claim. */
  signalEdgeObservations: number;
  /** Observations available for an execution-quality claim. */
  executionQualityObservations: number;
  /** Distinct whole UTC days present, the bootstrap clustering unit. */
  utcDays: number;
}

export function utcDayOf(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  return new Date(ms).toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Collapse customer broker executions into the two populations above.
 *
 * `1 signal x 100 executions` yields exactly ONE signal-edge observation and
 * ONE HUNDRED execution-quality observations.
 */
export function collapseCustomerExecutions(
  rows: readonly BrokerEvidenceObservation[],
): CollapsedSample {
  const bySignal = new Map<string, BrokerEvidenceObservation[]>();
  for (const row of rows) {
    const list = bySignal.get(row.signalId);
    if (list) list.push(row);
    else bySignal.set(row.signalId, [row]);
  }

  const signalEdge: SignalEdgeObservation[] = [];
  for (const [signalId, group] of bySignal) {
    const first = group[0] as BrokerEvidenceObservation;
    signalEdge.push({
      signalId,
      utcDay: utcDayOf(first.detectedAt),
      executions: group.length,
      accounts: new Set(group.map((g) => g.researchRef)).size,
      rVsPlan: median(group.map((g) => g.rVsPlan).filter((v): v is number => v !== null)),
    });
  }
  signalEdge.sort((a, b) => a.signalId.localeCompare(b.signalId));

  return {
    signalEdge,
    signalEdgeObservations: signalEdge.length,
    executionQualityObservations: rows.length,
    utcDays: new Set(signalEdge.map((s) => s.utcDay)).size,
  };
}

/**
 * The comparison Prompt 14 actually asks for: the SHADOW replay's modelled fill
 * against what the BROKER really did, per signal. Never merged into either
 * population above — it is a diagnostic, not a track record.
 */
export interface ShadowVsBrokerRow {
  signalId: string;
  shadowFilled: boolean;
  brokerFilled: boolean;
  shadowEntry: number | null;
  brokerEntry: number | null;
  shadowR: number | null;
  brokerR: number | null;
}

export interface ShadowVsBrokerComparison {
  compared: number;
  fillAgreement: number | null;
  /** Mean signed entry difference (broker - shadow), in price units. */
  meanSlippage: number | null;
  /** Mean signed R difference (broker - shadow). */
  meanRDifference: number | null;
  /** Rows the comparison could not use, with the reason kept honest. */
  unusable: number;
}

export function compareShadowToBroker(
  rows: readonly ShadowVsBrokerRow[],
): ShadowVsBrokerComparison {
  if (!rows.length) {
    return {
      compared: 0,
      fillAgreement: null,
      meanSlippage: null,
      meanRDifference: null,
      unusable: 0,
    };
  }
  let agreements = 0;
  const slippages: number[] = [];
  const rDiffs: number[] = [];
  let unusable = 0;

  for (const row of rows) {
    if (row.shadowFilled === row.brokerFilled) agreements += 1;
    if (row.shadowEntry !== null && row.brokerEntry !== null) {
      slippages.push(row.brokerEntry - row.shadowEntry);
    } else {
      unusable += 1;
    }
    if (row.shadowR !== null && row.brokerR !== null) rDiffs.push(row.brokerR - row.shadowR);
  }

  const mean = (v: number[]): number | null =>
    v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;

  return {
    compared: rows.length,
    fillAgreement: agreements / rows.length,
    meanSlippage: mean(slippages),
    meanRDifference: mean(rDiffs),
    unusable,
  };
}
