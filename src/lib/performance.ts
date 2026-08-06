import { contextOf, INSTRUMENT_LABELS, type Grade, type SignalRow, type TradeRow } from "./db-types";

export interface RSample {
  key: string;
  instrument: string;
  grade: Grade;
  outcome: "win" | "loss" | "breakeven";
  r: number;
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
  const avgLossR = losses.length ? Math.abs(losses.reduce((a, s) => a + s.r, 0) / losses.length) : 0;

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
      hour: ctx?.time_of_day ?? d.getUTCHours(),
      dayOfWeek: ctx?.day_of_week ?? d.getUTCDay(),
      session: ctx?.trading_session ?? "unknown",
    });
  }
  return out;
}

/** Personal samples: trades the user logged as taken and closed. */
export function samplesFromTrades(trades: TradeRow[], signals: SignalRow[]): RSample[] {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const out: RSample[] = [];
  for (const t of trades) {
    if (t.user_decision !== "taken") continue;
    if (t.outcome === "open" || t.realized_r_multiple === null) continue;
    const s = byId.get(t.signal_id);
    if (!s) continue;
    const ctx = contextOf(s);
    const d = new Date(s.detected_at);
    out.push({
      key: t.id,
      instrument: s.instrument,
      grade: s.grade,
      outcome: t.outcome,
      r: Number(t.realized_r_multiple),
      hour: ctx?.time_of_day ?? d.getUTCHours(),
      dayOfWeek: ctx?.day_of_week ?? d.getUTCDay(),
      session: ctx?.trading_session ?? "unknown",
    });
  }
  return out;
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
      out.push({ hour, dayOfWeek: day, count: list.length, expectancyR: stats.expectancyR, totalR: stats.totalR });
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
  return buckets.map((b) => ({ bucket: b.bucket, count: samples.filter((s) => b.test(s.r)).length }));
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Dynamically generated natural-language insights from the joined stats. */
export function generateInsights(samples: RSample[], scopeLabel: string): string[] {
  const overall = computeExpectancy(samples);
  if (overall.count < 3) {
    return [
      `${scopeLabel} has only ${overall.count} closed ${overall.count === 1 ? "result" : "results"} so far — log a few more before reading the numbers as signal.`,
    ];
  }

  const insights: string[] = [];

  insights.push(
    `${scopeLabel} is running an expectancy of ${fmtR(overall.expectancyR)} per trade across ${overall.count} closed setups — a ${pct(overall.winRate)} win rate with ${fmtR(overall.avgWinR)} average winners against ${fmtR(overall.avgLossR)} average losers.`,
  );

  const byInstrument = groupBy(samples, (s) => s.instrument).filter((g) => g.stats.count >= 3);
  const bestInstrument = [...byInstrument].sort((a, b) => b.stats.expectancyR - a.stats.expectancyR)[0];
  if (bestInstrument) {
    const label = INSTRUMENT_LABELS[bestInstrument.key] ?? bestInstrument.key;
    insights.push(
      `Your ${label} setups have a ${pct(bestInstrument.stats.winRate)} win rate with a ${fmtR(bestInstrument.stats.avgWinR)} average win, giving ${fmtR(bestInstrument.stats.expectancyR)} expectancy over ${bestInstrument.stats.count} trades.`,
    );
  }
  const worstInstrument = [...byInstrument].sort((a, b) => a.stats.expectancyR - b.stats.expectancyR)[0];
  if (worstInstrument && bestInstrument && worstInstrument.key !== bestInstrument.key && worstInstrument.stats.expectancyR < 0) {
    const label = INSTRUMENT_LABELS[worstInstrument.key] ?? worstInstrument.key;
    insights.push(
      `${label} is a net drag at ${fmtR(worstInstrument.stats.expectancyR)} expectancy over ${worstInstrument.stats.count} trades — consider excluding it until the structure improves.`,
    );
  }

  const byGrade = groupBy(samples, (s) => s.grade).filter((g) => g.stats.count >= 3);
  const bestGrade = [...byGrade].sort((a, b) => b.stats.expectancyR - a.stats.expectancyR)[0];
  const worstGrade = [...byGrade].sort((a, b) => a.stats.expectancyR - b.stats.expectancyR)[0];
  if (bestGrade) {
    insights.push(
      `${bestGrade.key}-Grade setups are your strongest tier at ${fmtR(bestGrade.stats.expectancyR)} expectancy and ${pct(bestGrade.stats.winRate)} win rate.`,
    );
  }
  if (worstGrade && bestGrade && worstGrade.key !== bestGrade.key && worstGrade.stats.expectancyR < 0.1) {
    insights.push(
      `${worstGrade.key}-Grade setups only return ${fmtR(worstGrade.stats.expectancyR)} per trade — raising your minimum grade above ${worstGrade.key} would have removed ${worstGrade.stats.count} low-value trades.`,
    );
  }

  const bySession = groupBy(samples, (s) => s.session).filter((g) => g.stats.count >= 3);
  const bestSession = [...bySession].sort((a, b) => b.stats.expectancyR - a.stats.expectancyR)[0];
  if (bestSession) {
    insights.push(
      `The ${bestSession.key.replace(/_/g, " ")} session carries ${fmtR(bestSession.stats.totalR)} of total R across ${bestSession.stats.count} trades — your highest-yield window.`,
    );
  }

  const byDay = groupBy(samples, (s) => s.dayOfWeek).filter((g) => g.stats.count >= 3);
  const worstDay = [...byDay].sort((a, b) => a.stats.expectancyR - b.stats.expectancyR)[0];
  if (worstDay && worstDay.stats.expectancyR < 0) {
    insights.push(
      `${DAY_NAMES[worstDay.key as number]} is negative at ${fmtR(worstDay.stats.expectancyR)} expectancy over ${worstDay.stats.count} trades.`,
    );
  }

  return insights;
}

export function fmtR(v: number): string {
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(2)}R`;
}

export function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
