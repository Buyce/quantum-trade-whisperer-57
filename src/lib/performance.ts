import {
  contextOf,
  INSTRUMENT_LABELS,
  type Grade,
  type SignalRow,
  type TradeRow,
} from "./db-types";
import { selectR, type RBasis } from "./journal/r-math";
import type { PerformanceEvidenceRow } from "./performance-evidence";
import { MIN_GROUP_SAMPLES } from "./stats/evidence";

export interface RSample {
  key: string;
  instrument: string;
  grade: Grade | "Unknown";
  outcome: "win" | "loss" | "breakeven";
  r: number;
  /** ISO timestamp of when the setup was detected (used by CSV export). */
  detectedAt: string;
  hour: number;
  dayOfWeek: number;
  session: string;
}

export interface Expectancy {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  lossRate: number;
  avgWinR: number;
  avgLossR: number;
  /** Expectancy in R = (Win Rate x Average Win in R) - (Loss Rate x Average Loss in R). */
  expectancyR: number;
  totalR: number;
}

export const EMPTY_EXPECTANCY: Expectancy = {
  count: 0,
  wins: 0,
  losses: 0,
  breakeven: 0,
  winRate: 0,
  lossRate: 0,
  avgWinR: 0,
  avgLossR: 0,
  expectancyR: 0,
  totalR: 0,
};

export function computeExpectancy(samples: RSample[]): Expectancy {
  if (samples.length === 0) return EMPTY_EXPECTANCY;
  const wins = samples.filter((s) => s.outcome === "win");
  const losses = samples.filter((s) => s.outcome === "loss");
  const breakeven = samples.filter((s) => s.outcome === "breakeven");

  const winRate = wins.length / samples.length;
  const lossRate = losses.length / samples.length;
  const avgWinR = wins.length ? wins.reduce((a, s) => a + s.r, 0) / wins.length : 0;
  const avgLossR = losses.length
    ? Math.abs(losses.reduce((a, s) => a + s.r, 0) / losses.length)
    : 0;

  return {
    count: samples.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate,
    lossRate,
    avgWinR,
    avgLossR,
    expectancyR: winRate * avgWinR - lossRate * avgLossR,
    totalR: samples.reduce((a, s) => a + s.r, 0),
  };
}

/** Baseline samples: outcomes the scanner itself resolved. */
export function samplesFromSignals(signals: SignalRow[]): RSample[] {
  const out: RSample[] = [];
  for (const s of signals) {
    if (s.resolved_outcome === "open" || s.resolved_r_multiple === null) continue;
    const ctx = contextOf(s);
    const d = new Date(s.detected_at);
    out.push({
      key: s.id,
      instrument: s.instrument,
      grade: s.grade,
      outcome: s.resolved_outcome,
      r: Number(s.resolved_r_multiple),
      detectedAt: s.detected_at,
      hour: ctx?.time_of_day ?? d.getUTCHours(),
      dayOfWeek: ctx?.day_of_week ?? d.getUTCDay(),
      session: ctx?.trading_session ?? "unknown",
    });
  }
  return out;
}

/**
 * Personal samples: trades the user logged as taken and closed.
 *
 * Context comes from the row's own immutable creation-time snapshot first, so a
 * trade is never silently dropped because its signal row is gone (the signal
 * join is only a fallback for rows logged before snapshots existed).
 *
 * The caller MUST name the R basis. Only canonical rows of that basis are
 * included — frozen legacy R lives in `legacySamplesFromTrades` and is never
 * pooled with canonical values.
 */
export function samplesFromTrades(
  trades: TradeRow[],
  signals: SignalRow[],
  basis: RBasis = "actual_risk",
): RSample[] {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const out: RSample[] = [];
  for (const t of trades) {
    if (t.user_decision !== "taken") continue;
    if (t.outcome === "open") continue;
    const r = selectR(
      { r_vs_plan: t.r_vs_plan ?? null, r_vs_actual_risk: t.r_vs_actual_risk ?? null },
      basis,
    );
    if (r === null) continue;
    const sample = buildTradeSample(t, byId.get(t.signal_id), r);
    if (sample) out.push(sample);
  }
  return out;
}

/** Broker-confirmed samples. The caller names one R basis; null rows stay out. */
export function samplesFromBrokerEvidence(
  evidence: PerformanceEvidenceRow[],
  basis: RBasis,
): RSample[] {
  const out: RSample[] = [];
  for (const row of evidence) {
    const r = basis === "plan" ? row.rVsPlan : row.rVsActualRisk;
    if (r === null || !Number.isFinite(r)) continue;
    out.push({
      key: row.key,
      instrument: row.instrument,
      grade: row.grade,
      outcome: r > 0 ? "win" : r < 0 ? "loss" : "breakeven",
      r,
      detectedAt: row.detectedAt,
      hour: row.hour,
      dayOfWeek: row.dayOfWeek,
      session: row.session,
    });
  }
  return out;
}

/**
 * Frozen legacy R rows (pre-r-math version 1). Mixed basis by construction:
 * surface them separately and labelled, never averaged with canonical R.
 */
export function legacySamplesFromTrades(trades: TradeRow[], signals: SignalRow[]): RSample[] {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const out: RSample[] = [];
  for (const t of trades) {
    if (t.user_decision !== "taken") continue;
    if (t.outcome === "open") continue;
    if (t.r_vs_plan != null || t.r_vs_actual_risk != null) continue;
    if (t.realized_r_multiple == null) continue;
    const sample = buildTradeSample(t, byId.get(t.signal_id), Number(t.realized_r_multiple));
    if (sample) out.push(sample);
  }
  return out;
}

function buildTradeSample(t: TradeRow, signal: SignalRow | undefined, r: number): RSample | null {
  const ctx = signal ? contextOf(signal) : null;
  const detectedAt = t.signal_detected_at ?? signal?.detected_at ?? t.created_at;
  if (!detectedAt) return null;
  const d = new Date(detectedAt);
  const instrument = t.signal_instrument ?? signal?.instrument;
  const grade = (t.signal_grade as Grade | null) ?? signal?.grade;
  if (!instrument || !grade) return null;
  return {
    key: t.id,
    instrument,
    grade,
    outcome: t.outcome as "win" | "loss" | "breakeven",
    r,
    detectedAt,
    hour: t.signal_time_of_day ?? ctx?.time_of_day ?? d.getUTCHours(),
    dayOfWeek: t.signal_day_of_week ?? ctx?.day_of_week ?? d.getUTCDay(),
    session: t.signal_trading_session ?? ctx?.trading_session ?? "unknown",
  };
}

export function groupBy<K extends string | number>(
  samples: RSample[],
  keyFn: (s: RSample) => K,
): Array<{ key: K; stats: Expectancy }> {
  const map = new Map<K, RSample[]>();
  for (const s of samples) {
    const k = keyFn(s);
    const list = map.get(k);
    if (list) list.push(s);
    else map.set(k, [s]);
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, stats: computeExpectancy(list) }))
    .sort((a, b) => b.stats.count - a.stats.count);
}

export interface HeatCell {
  hour: number;
  dayOfWeek: number;
  count: number;
  expectancyR: number;
  totalR: number;
}

/** Time-of-day x weekday heat map, bucketed into 3-hour blocks. */
export function heatMap(samples: RSample[]): HeatCell[] {
  const cells = new Map<string, RSample[]>();
  for (const s of samples) {
    const bucket = Math.floor(s.hour / 3) * 3;
    const key = `${s.dayOfWeek}:${bucket}`;
    const list = cells.get(key);
    if (list) list.push(s);
    else cells.set(key, [s]);
  }
  const out: HeatCell[] = [];
  for (let day = 1; day <= 5; day += 1) {
    for (let hour = 0; hour < 24; hour += 3) {
      const list = cells.get(`${day}:${hour}`) ?? [];
      const stats = computeExpectancy(list);
      out.push({
        hour,
        dayOfWeek: day,
        count: list.length,
        expectancyR: stats.expectancyR,
        totalR: stats.totalR,
      });
    }
  }
  return out;
}

export function rDistribution(samples: RSample[]): Array<{ bucket: string; count: number }> {
  const buckets = [
    { bucket: "< -1R", test: (r: number) => r < -1 },
    { bucket: "-1R to 0", test: (r: number) => r >= -1 && r < 0 },
    { bucket: "0 to 1R", test: (r: number) => r >= 0 && r < 1 },
    { bucket: "1R to 2R", test: (r: number) => r >= 1 && r < 2 },
    { bucket: "2R to 3R", test: (r: number) => r >= 2 && r < 3 },
    { bucket: "3R+", test: (r: number) => r >= 3 },
  ];
  return buckets.map((b) => ({
    bucket: b.bucket,
    count: samples.filter((s) => b.test(s.r)).length,
  }));
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Descriptive read-out of the joined stats.
 *
 * NON-PRESCRIPTIVE BY CONSTRUCTION: these lines describe what was logged. They
 * never recommend excluding an instrument, raising a minimum grade, naming a
 * "strongest tier" or a "highest-yield window", or any other optimisation
 * inferred from a small sample. Sufficiency is not decided here either — a
 * subgroup below the shared floor is labelled as too small to read.
 */
export function generateInsights(samples: RSample[], scopeLabel: string): string[] {
  const overall = computeExpectancy(samples);
  if (overall.count === 0) {
    return [`${scopeLabel} has no closed results yet, so there is nothing to describe.`];
  }

  const insights: string[] = [];
  const small = overall.count < MIN_GROUP_SAMPLES;

  insights.push(
    `${scopeLabel}: ${overall.count} closed ${overall.count === 1 ? "setup" : "setups"} recorded, ` +
      `${pct(overall.winRate)} of them positive, average winner ${fmtR(overall.avgWinR)}, ` +
      `average loser ${fmtR(overall.avgLossR)}, arithmetic expectancy ${fmtR(overall.expectancyR)} per trade.`,
  );

  if (small) {
    insights.push(
      `This is a sample of ${overall.count}, below the ${MIN_GROUP_SAMPLES}-result floor used across P-Trades. ` +
        `The figures above are a record of what happened, not an estimate of what to expect, and no conclusion is drawn from them.`,
    );
    return insights;
  }

  // Above the floor the read-out stays descriptive: counts and totals only, and
  // every subgroup is reported with its own sample size so the reader can judge.
  const describe = (
    heading: string,
    groups: Array<{ key: string | number; stats: ReturnType<typeof computeExpectancy> }>,
    label: (key: string | number) => string,
  ) => {
    const usable = groups.filter((g) => g.stats.count >= MIN_GROUP_SAMPLES);
    if (usable.length === 0) {
      insights.push(
        `${heading}: every breakdown is below ${MIN_GROUP_SAMPLES} results, so none is reported separately.`,
      );
      return;
    }
    for (const g of usable) {
      insights.push(
        `${heading} — ${label(g.key)}: ${g.stats.count} results, ${pct(g.stats.winRate)} positive, ` +
          `${fmtR(g.stats.totalR)} total R, ${fmtR(g.stats.expectancyR)} per trade (descriptive).`,
      );
    }
  };

  describe(
    "By instrument",
    groupBy(samples, (s) => s.instrument),
    (k) => INSTRUMENT_LABELS[k as string] ?? String(k),
  );
  describe(
    "By grade",
    groupBy(samples, (s) => s.grade),
    (k) => `${k}-Grade`,
  );
  describe(
    "By session",
    groupBy(samples, (s) => s.session),
    (k) => String(k).replace(/_/g, " "),
  );
  describe(
    "By weekday",
    groupBy(samples, (s) => s.dayOfWeek),
    (k) => DAY_NAMES[k as number] ?? String(k),
  );

  insights.push(
    "All figures are descriptive summaries of logged results. Forward-looking claims require the shared evidence gate, which these numbers do not pass on their own.",
  );

  return insights;
}

export function fmtR(v: number): string {
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(2)}R`;
}

export function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
