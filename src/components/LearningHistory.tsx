/**
 * Learning history — how the regime statistics have evolved across model
 * iterations. Sourced entirely from `regime_snapshots`, which the hourly
 * recompute appends to.
 *
 * ZERO-HALLUCINATION: with no logged iterations this renders an explicit empty
 * state. It never interpolates, back-fills, or invents a trend line.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { regimeSnapshotsQuery, type RegimeSnapshotRow } from "@/lib/queries";
import { MIN_N_FILL, MIN_N_WIN } from "@/lib/learning/regime";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoLabel } from "@/components/GuideMode";

const pct = (v: number | null) => (v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`);

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LearningHistory() {
  const { data, isLoading } = useQuery(regimeSnapshotsQuery());
  const [regime, setRegime] = useState("global");

  const rows = data ?? [];

  /** Every regime that has ever been logged, most-sampled first. */
  const options = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.regime_key, Math.max(seen.get(r.regime_key) ?? 0, r.n_total));
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  }, [rows]);

  const series = useMemo(() => {
    return rows
      .filter((r) => r.regime_key === regime)
      .slice()
      .sort((a, b) => a.computed_at.localeCompare(b.computed_at))
      .map((r) => ({
        at: timeLabel(r.computed_at),
        resolved: r.n_total,
        filled: r.n_filled,
        fill: r.p_fill_shrunk == null ? null : Number(r.p_fill_shrunk) * 100,
        win: r.p_win_shrunk == null ? null : Number(r.p_win_shrunk) * 100,
        fillRaw: r.p_fill_raw == null ? null : Number(r.p_fill_raw) * 100,
        winRaw: r.p_win_raw == null ? null : Number(r.p_win_raw) * 100,
      }));
  }, [rows, regime]);

  const iterations = useMemo(() => {
    const runs = new Map<string, RegimeSnapshotRow>();
    for (const r of rows) if (r.tier === 1 && !runs.has(r.run_id)) runs.set(r.run_id, r);
    return [...runs.values()].sort((a, b) => b.computed_at.localeCompare(a.computed_at)).slice(0, 20);
  }, [rows]);

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  if (rows.length === 0) {
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="label-xs">Learning history</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No model iteration has been logged yet. The learning engine appends a full copy of its
          statistics every time it recomputes (hourly, after shadow replay resolves), so the first
          entry appears at the next cycle.
        </p>
      </section>
    );
  }

  const latest = iterations[0];

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label-xs">
            <InfoLabel hint="Each hourly recompute writes a full copy of the regime statistics. This chart replays those copies so you can watch a regime's rates move as samples accumulate — smoothed lines are what the app uses, raw lines are the unsmoothed measurement.">
              Regime evolution
            </InfoLabel>
          </h2>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Regime
            <select
              value={regime}
              onChange={(e) => setRegime(e.target.value)}
              aria-label="Select regime to chart"
              className="num max-w-[16rem] rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>

        {series.length < 2 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Only {series.length} iteration logged for this regime — a trend needs at least two.
          </p>
        ) : (
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="at" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  domain={[0, 100]}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="fill"
                  name="Fill rate (smoothed)"
                  stroke="var(--color-chart-1)"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="win"
                  name="Win if filled (smoothed)"
                  stroke="var(--color-chart-2)"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="fillRaw"
                  name="Fill rate (raw)"
                  stroke="var(--color-chart-1)"
                  strokeDasharray="4 3"
                  dot={false}
                  strokeWidth={1}
                />
                <Line
                  type="monotone"
                  dataKey="winRaw"
                  name="Win if filled (raw)"
                  stroke="var(--color-chart-2)"
                  strokeDasharray="4 3"
                  dot={false}
                  strokeWidth={1}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label-xs">Model iterations (global row)</h2>
          {latest ? (
            <span className="num text-xs text-muted-foreground">
              gates: {latest.n_total}/{MIN_N_FILL} resolved · {latest.n_filled}/{MIN_N_WIN} filled
            </span>
          ) : null}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="label-xs py-2 pr-3 font-normal">Computed</th>
                <th className="label-xs py-2 pr-3 text-right font-normal">Resolved</th>
                <th className="label-xs py-2 pr-3 text-right font-normal">Filled</th>
                <th className="label-xs py-2 pr-3 text-right font-normal">Wins</th>
                <th className="label-xs py-2 pr-3 text-right font-normal">Fill rate</th>
                <th className="label-xs py-2 text-right font-normal">Win if filled</th>
              </tr>
            </thead>
            <tbody>
              {iterations.map((r) => (
                <tr key={r.run_id} className="border-b border-border/50 last:border-0">
                  <td className="num py-2 pr-3 text-xs text-muted-foreground">
                    {timeLabel(r.computed_at)}
                  </td>
                  <td className="num py-2 pr-3 text-right">{r.n_total}</td>
                  <td className="num py-2 pr-3 text-right">{r.n_filled}</td>
                  <td className="num py-2 pr-3 text-right">{r.wins}</td>
                  <td className="num py-2 pr-3 text-right">{pct(r.p_fill_raw)}</td>
                  <td className="num py-2 text-right">{pct(r.p_win_raw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-snug text-muted-foreground">
          Table shows unsmoothed dataset-wide rates per iteration — the honest measurement behind the
          advisory numbers on each signal. Older than 180 days is pruned.
        </p>
      </section>
    </div>
  );
}
