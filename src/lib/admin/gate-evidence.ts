/**
 * Intelligence-gate evidence, per instrument/direction cohort.
 *
 * Three independent readings are placed side by side and NEVER blended:
 *  - the replay win-if-filled rate and its filled sample count (`regime_stats`),
 *  - the replay expected R per published plan and its interval (`payoff_stats`),
 *  - what the broker actually paid on closed customer evidence.
 *
 * The verdict column reports what the owner's current thresholds would do to a
 * cohort. A cohort with no reportable measurement is `refused_unmeasured`, never
 * a pass, and every money or rate figure is null when it was not measured.
 *
 * Pure and total: no clock, no Supabase.
 */

export type GateVerdict =
  "gate_off" | "allowed" | "refused_unmeasured" | "refused_win_rate" | "refused_expected_r";

export interface GateEvidenceThresholds {
  enabled: boolean;
  minWinPct: number | null;
  minSample: number;
  minExpectedR: number | null;
}

export interface RegimeInput {
  instrument: string | null;
  direction: string | null;
  pWin: number | null;
  filledN: number | null;
}

export interface PayoffInput {
  instrument: string | null;
  direction: string | null;
  meanR: number | null;
  nUsed: number | null;
  ciLo: number | null;
  ciHi: number | null;
  statStatus: string | null;
}

export interface BrokerInput {
  instrument: string | null;
  direction: string | null;
  /** Broker net money for one closed trade, or null when unreported. */
  netProfit: number | null;
  currency: string | null;
}

export interface GateEvidenceRow {
  instrument: string;
  direction: string;
  /** Best measured win-if-filled rate as a percentage; null when unmeasured. */
  winPct: number | null;
  filledN: number | null;
  expectedR: number | null;
  expectedRN: number | null;
  ciLo: number | null;
  ciHi: number | null;
  brokerTrades: number;
  brokerWins: number;
  brokerLosses: number;
  brokerNet: number | null;
  brokerCurrency: string | null;
  brokerMixedCurrency: boolean;
  verdict: GateVerdict;
}

const key = (i: string | null, d: string | null): string | null => {
  if (!i || !d) return null;
  return `${i.toUpperCase()}|${d.toLowerCase()}`;
};

export function buildGateEvidence(
  thresholds: GateEvidenceThresholds,
  regime: RegimeInput[],
  payoff: PayoffInput[],
  broker: BrokerInput[],
): GateEvidenceRow[] {
  const cohorts = new Map<string, GateEvidenceRow>();
  const ensure = (k: string): GateEvidenceRow => {
    const existing = cohorts.get(k);
    if (existing) return existing;
    const [instrument, direction] = k.split("|");
    const row: GateEvidenceRow = {
      instrument: instrument!,
      direction: direction!,
      winPct: null,
      filledN: null,
      expectedR: null,
      expectedRN: null,
      ciLo: null,
      ciHi: null,
      brokerTrades: 0,
      brokerWins: 0,
      brokerLosses: 0,
      brokerNet: null,
      brokerCurrency: null,
      brokerMixedCurrency: false,
      verdict: "gate_off",
    };
    cohorts.set(k, row);
    return row;
  };

  // Best-measured regime row per cohort: the largest filled sample wins.
  for (const r of regime) {
    const k = key(r.instrument, r.direction);
    if (!k) continue;
    if (r.pWin === null || !Number.isFinite(r.pWin)) continue;
    const row = ensure(k);
    const n = Number(r.filledN ?? 0);
    if (row.filledN === null || n > row.filledN) {
      row.filledN = n;
      row.winPct = Number((r.pWin * 100).toFixed(1));
    }
  }

  for (const p of payoff) {
    const k = key(p.instrument, p.direction);
    if (!k) continue;
    if (p.statStatus !== "descriptive") continue;
    if (p.meanR === null || !Number.isFinite(p.meanR)) continue;
    const row = ensure(k);
    const n = Number(p.nUsed ?? 0);
    if (row.expectedRN === null || n > row.expectedRN) {
      row.expectedRN = n;
      row.expectedR = Number(p.meanR.toFixed(4));
      row.ciLo = p.ciLo;
      row.ciHi = p.ciHi;
    }
  }

  for (const b of broker) {
    const k = key(b.instrument, b.direction);
    if (!k) continue;
    const row = ensure(k);
    row.brokerTrades += 1;
    if (b.netProfit === null) continue;
    if (b.netProfit > 0) row.brokerWins += 1;
    else if (b.netProfit < 0) row.brokerLosses += 1;
    if (row.brokerCurrency === null) row.brokerCurrency = b.currency ?? null;
    else if (b.currency && b.currency !== row.brokerCurrency) row.brokerMixedCurrency = true;
    row.brokerNet = (row.brokerNet ?? 0) + b.netProfit;
  }

  for (const row of cohorts.values()) {
    if (row.brokerMixedCurrency) row.brokerNet = null;
    row.verdict = verdictFor(thresholds, row);
  }

  return [...cohorts.values()].sort(
    (a, b) => a.instrument.localeCompare(b.instrument) || a.direction.localeCompare(b.direction),
  );
}

export function verdictFor(t: GateEvidenceThresholds, row: GateEvidenceRow): GateVerdict {
  const winConfigured = t.enabled && t.minWinPct !== null && t.minWinPct > 0;
  const erConfigured = t.enabled && t.minExpectedR !== null && Number.isFinite(t.minExpectedR);
  if (!winConfigured && !erConfigured) return "gate_off";

  if (erConfigured) {
    if (row.expectedR === null) return "refused_unmeasured";
    if (row.ciHi !== null && row.ciHi < 0) return "refused_expected_r";
    if (row.expectedR < (t.minExpectedR as number)) return "refused_expected_r";
  }
  if (winConfigured) {
    const floor = Math.max(1, t.minSample);
    if (row.winPct === null || row.filledN === null || row.filledN < floor)
      return "refused_unmeasured";
    if (row.winPct < (t.minWinPct as number)) return "refused_win_rate";
  }
  return "allowed";
}

export const GATE_VERDICT_COPY: Record<GateVerdict, string> = {
  gate_off: "Gate off — no threshold set, so nothing is refused",
  allowed: "Would be allowed",
  refused_unmeasured: "Refused — not measured well enough to judge",
  refused_win_rate: "Refused — win-if-filled rate below threshold",
  refused_expected_r: "Refused — expected return below floor",
};
