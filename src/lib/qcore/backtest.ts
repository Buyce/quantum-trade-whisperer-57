import type { QCoreInput, QState } from "./types";
import type { QCorePolicy } from "./config";
import { QCORE_POLICY_V2 } from "./config";
import { evaluateQCore } from "./engine";

export interface QCoreBacktestObservation {
  id: string;
  detectedAt: string;
  instrument: string;
  input: QCoreInput;
  /** Forward outcome produced by a frozen replay policy, never by Q-Core itself. */
  realizedR: number | null;
  filled: boolean | null;
}

export interface QCoreBacktestRow {
  id: string;
  detectedAt: string;
  instrument: string;
  state: QState;
  confidence: number;
  coverageSufficient: boolean;
  realizedR: number | null;
  filled: boolean | null;
}

export interface QCoreBacktestMetrics {
  n: number;
  resolvedN: number;
  filledN: number;
  meanR: number | null;
  winRate: number | null;
  cumulativeR: number;
  maxDrawdownR: number;
  stateCounts: Record<QState, number>;
}

export interface QCoreBacktestResult {
  policyId: string;
  rows: QCoreBacktestRow[];
  metrics: QCoreBacktestMetrics;
}

function round(v: number, d = 4): number {
  return Number(v.toFixed(d));
}

/**
 * Deterministic Q-Core backtest over pre-built, point-in-time feature vectors.
 *
 * This function deliberately does NOT fetch candles, choose outcomes, tune
 * weights, or infer missing R. Historical feature construction and the replay
 * labeller remain separate so future information cannot leak into Q-Core input.
 */
export function backtestQCore(
  observations: readonly QCoreBacktestObservation[],
  policy: QCorePolicy = QCORE_POLICY_V2,
): QCoreBacktestResult {
  const rows = [...observations]
    .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt) || a.id.localeCompare(b.id))
    .map((o) => {
      const q = evaluateQCore(o.input, policy);
      return {
        id: o.id,
        detectedAt: o.detectedAt,
        instrument: o.instrument,
        state: q.state,
        confidence: q.confidence,
        coverageSufficient: q.coverageSufficient,
        realizedR: Number.isFinite(o.realizedR) ? o.realizedR : null,
        filled: o.filled,
      };
    });

  const resolved = rows.filter(
    (r): r is QCoreBacktestRow & { realizedR: number } => r.realizedR !== null,
  );
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const row of resolved) {
    equity += row.realizedR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }

  const stateCounts: Record<QState, number> = { long: 0, neutral: 0, short: 0 };
  for (const row of rows) stateCounts[row.state] += 1;

  return {
    policyId: policy.id,
    rows,
    metrics: {
      n: rows.length,
      resolvedN: resolved.length,
      filledN: rows.filter((r) => r.filled === true).length,
      meanR: resolved.length
        ? round(resolved.reduce((s, r) => s + r.realizedR, 0) / resolved.length)
        : null,
      winRate: resolved.length
        ? round(resolved.filter((r) => r.realizedR > 0).length / resolved.length)
        : null,
      cumulativeR: round(equity),
      maxDrawdownR: round(maxDrawdownR),
      stateCounts,
    },
  };
}
