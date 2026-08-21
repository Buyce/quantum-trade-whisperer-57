import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Lightbulb } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { myTradesQuery, signalsQuery } from "@/lib/queries";
import { INSTRUMENT_LABELS } from "@/lib/db-types";
import {
  computeExpectancy,
  fmtR,
  generateInsights,
  groupBy,
  heatMap,
  pct,
  rDistribution,
  samplesFromSignals,
  samplesFromTrades,
} from "@/lib/performance";
import { downloadCsv, samplesToCsv, todayStamp } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfoLabel } from "@/components/GuideMode";
import { LearningHistory } from "@/components/LearningHistory";
import { SignalAudit } from "@/components/SignalAudit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({
    meta: [
      { title: "Performance Engine — P-Trades Hub" },
      {
        name: "description",
        content: "Trading expectancy in R, win rate, R distribution and a time-of-day heat map for your logged trades.",
      },
      { property: "og:title", content: "Performance Engine — P-Trades Hub" },
      { property: "og:description", content: "R-multiple expectancy analytics for your forex trade log." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PerformancePage,
});

const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
const GRADE_TIERS = ["A+", "A", "B", "C"] as const;
/**
 * Below these counts a chart is noise dressed as analysis, so we say what is
 * missing instead of drawing an empty grid.
 */
const MIN_SAMPLES_CHART = 5;
const MIN_SAMPLES_HEATMAP = 10;


function PerformancePage() {
  const { user } = useAuth();
  const signals = useQuery(signalsQuery());
  const trades = useQuery(myTradesQuery(user?.id));
  const [scope, setScope] = useState<"mine" | "baseline">("mine");

  const mine = useMemo(
    () => samplesFromTrades(trades.data ?? [], signals.data ?? []),
    [trades.data, signals.data],
  );
  const baseline = useMemo(() => samplesFromSignals(signals.data ?? []), [signals.data]);

  const effectiveScope = scope === "mine" && mine.length === 0 ? "baseline" : scope;
  const samples = effectiveScope === "mine" ? mine : baseline;
  const scopeLabel = effectiveScope === "mine" ? "Your trade log" : "The scanner baseline";

  // Global math reflects the core edge: C-Grade is excluded from the top-row KPIs,
  // insights, distribution and heat map, but kept in the per-tier tables.
  const coreSamples = useMemo(() => samples.filter((s) => s.grade !== "C"), [samples]);

  const stats = useMemo(() => computeExpectancy(coreSamples), [coreSamples]);
  const dist = useMemo(() => rDistribution(coreSamples), [coreSamples]);
  const cells = useMemo(() => heatMap(coreSamples), [coreSamples]);
  const byInstrument = useMemo(() => groupBy(samples, (s) => s.instrument), [samples]);
  // All four tiers always render, even when a tier has no setups yet.
  const byGrade = useMemo(() => {
    const grouped = groupBy(samples, (s) => s.grade);
    return GRADE_TIERS.map((tier) => {
      const found = grouped.find((g) => g.key === tier);
      return { key: tier, stats: found ? found.stats : computeExpectancy([]) };
    });
  }, [samples]);

  const insights = useMemo(() => generateInsights(coreSamples, scopeLabel), [coreSamples, scopeLabel]);


  function exportMetrics() {
    if (samples.length === 0) return;
    downloadCsv(`ptrades_performance_${effectiveScope}_${todayStamp()}.csv`, samplesToCsv(samples));
  }

  const maxAbs = Math.max(0.01, ...cells.map((c) => Math.abs(c.expectancyR)));

  if (signals.isLoading || trades.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:flex sm:flex-wrap sm:items-end">
        <div className="min-w-0">
          <p className="label-xs">Phase 3 · Performance engine</p>
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">Performance</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          <Tabs value={effectiveScope} onValueChange={(v) => setScope(v as "mine" | "baseline")}>
            <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
              <TabsTrigger value="mine">My trade log</TabsTrigger>
              <TabsTrigger value="baseline">Scanner baseline</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="ghost" disabled={samples.length === 0} onClick={exportMetrics}>
            <Download className="size-4" /> Export Metrics (CSV)
          </Button>
        </div>
      </div>

      {signals.isError || trades.isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Could not load performance data, so the metrics below are incomplete. Reload before drawing
          conclusions from them.
        </p>
      ) : null}

      {scope === "mine" && mine.length === 0 ? (
        <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          You have no closed trades yet, so these numbers show the scanner baseline — every graded setup and how
          it resolved. Log trades in the feed to see your own expectancy here.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label="Expectancy / trade"
          hint="What one average setup is worth in R. +0.30R means every trade adds 0.3× your risk over the long run."
          value={fmtR(stats.expectancyR)}
          tone={stats.expectancyR > 0 ? "pos" : stats.expectancyR < 0 ? "neg" : undefined}
        />
        <Kpi
          label="Win rate"
          hint="Share of closed setups that finished profitable. A low win rate can still be profitable if wins are large."
          value={pct(stats.winRate)}
        />
        <Kpi
          label="Avg win"
          hint="Average size of a winning trade in R — multiples of the amount you risked."
          value={fmtR(stats.avgWinR)}
          tone="pos"
        />
        <Kpi
          label="Avg loss"
          hint="Average size of a losing trade in R. Respecting the stop-loss keeps this near −1R."
          value={fmtR(stats.avgLossR)}
          tone="neg"
        />
        <Kpi
          label="Total R"
          hint="All closed results added up, in R. Multiply by your risk per trade to get currency."
          value={fmtR(stats.totalR)}
          tone={stats.totalR >= 0 ? "pos" : "neg"}
        />
        <Kpi
          label="Closed setups"
          hint="How many trades have a recorded result. Below ~30, treat these numbers as early signals only."
          value={String(stats.count)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Global metrics above reflect B-Grade and above — C-Grade setups are excluded so they do not drag down the
        core edge. C-Grade performance is tracked separately in the “By grade tier” table below.
      </p>


      {/* Progressive disclosure: KPIs and insights are always visible, the heavier
          charts and tables sit behind tabs so the page opens light. */}
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="label-xs flex items-center gap-1.5">
          <Lightbulb className="size-3.5" /> Generated insights
        </h2>
        <ul className="mt-3 space-y-2">
          {insights.map((line, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
              <span className="num text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <Tabs defaultValue="distribution" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 lg:inline-flex lg:h-9 lg:w-auto lg:gap-0">
          <TabsTrigger className="h-10 lg:h-auto" value="distribution">R distribution</TabsTrigger>
          <TabsTrigger value="timing">Timing</TabsTrigger>
          <TabsTrigger value="instrument">By instrument</TabsTrigger>
          <TabsTrigger value="grade">By grade</TabsTrigger>
          <TabsTrigger value="signals">Signal audit</TabsTrigger>
          <TabsTrigger value="learning">Learning</TabsTrigger>
        </TabsList>

        <TabsContent value="distribution">
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="label-xs">R-multiple distribution</h2>
            {coreSamples.length < MIN_SAMPLES_CHART ? (
              <NeedsSamples have={coreSamples.length} need={MIN_SAMPLES_CHART} what="a distribution" />
            ) : (
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dist}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="bucket" stroke="var(--color-muted-foreground)" fontSize={11} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="timing">
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="label-xs">Time-of-day heat map · expectancy in R (UTC)</h2>
            {coreSamples.length < MIN_SAMPLES_HEATMAP ? (
              <NeedsSamples have={coreSamples.length} need={MIN_SAMPLES_HEATMAP} what="a time-of-day map" />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-separate border-spacing-0.5">
                  <thead>
                    <tr>
                      <th className="label-xs w-10 text-left" />
                      {Array.from({ length: 8 }, (_, i) => i * 3).map((h) => (
                        <th key={h} className="label-xs px-1 text-center">
                          {String(h).padStart(2, "0")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5].map((day) => (
                      <tr key={day}>
                        <td className="label-xs pr-1">{DAY_LABELS[day]}</td>
                        {Array.from({ length: 8 }, (_, i) => i * 3).map((hour) => {
                          const cell = cells.find((c) => c.dayOfWeek === day && c.hour === hour);
                          const v = cell?.expectancyR ?? 0;
                          const alpha = cell && cell.count > 0 ? Math.min(0.85, Math.abs(v) / maxAbs) : 0;
                          const color = v >= 0 ? "var(--color-success)" : "var(--color-destructive)";
                          return (
                            <td key={hour} className="p-0">
                              <div
                                title={
                                  cell && cell.count
                                    ? `${DAY_LABELS[day]} ${String(hour).padStart(2, "0")}:00 — ${cell.count} trades, ${fmtR(v)}`
                                    : "No data"
                                }
                                className="grid h-9 place-items-center rounded-sm border border-border/60"
                                style={{
                                  backgroundColor: alpha
                                    ? `color-mix(in oklab, ${color} ${alpha * 100}%, transparent)`
                                    : undefined,
                                }}
                              >
                                <span className="num text-[10px] text-foreground/80">
                                  {cell && cell.count ? v.toFixed(1) : ""}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="instrument">
          <BreakdownTable
            title="By instrument"
            rows={byInstrument.map((g) => ({
              label: `${g.key} · ${INSTRUMENT_LABELS[g.key] ?? ""}`,
              stats: g.stats,
            }))}
          />
        </TabsContent>

        <TabsContent value="grade">
          <BreakdownTable
            title="By grade tier"
            rows={byGrade.map((g) => ({
              label: g.key === "A+" ? "A+ Grade" : `${g.key}-Grade`,
              stats: g.stats,
            }))}
          />
        </TabsContent>

        <TabsContent value="signals">
          <SignalAudit />
        </TabsContent>

        <TabsContent value="learning">
          <LearningHistory />
        </TabsContent>
      </Tabs>

    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | undefined;
  hint?: string;
}) {
  return (
    <div className="min-w-0 bg-card px-3 py-3.5 sm:px-4 sm:py-3">
      <p className="label-xs">{hint ? <InfoLabel hint={hint}>{label}</InfoLabel> : label}</p>
      <p
        className={cn(
          "num mt-1 text-xl font-bold",
          tone === "pos" ? "text-success" : tone === "neg" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; stats: ReturnType<typeof computeExpectancy> }>;
}) {
  return (
    <section className="rounded-md border border-border bg-card">
      <p className="label-xs border-b border-border px-4 py-3">{title}</p>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border">
            {["", "N", "Win%", "Avg win", "Avg loss", "Expectancy"].map((h) => (
              <th key={h} className="label-xs px-3 py-2 text-right first:text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                No closed results yet.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.label} className="border-b border-border/60 last:border-0">
                <td className="num px-3 py-2 text-left text-xs">{r.label}</td>
                <td className="num px-3 py-2 text-right text-xs">{r.stats.count}</td>
                <td className="num px-3 py-2 text-right text-xs">{pct(r.stats.winRate)}</td>
                <td className="num px-3 py-2 text-right text-xs text-success">{fmtR(r.stats.avgWinR)}</td>
                <td className="num px-3 py-2 text-right text-xs text-destructive">{fmtR(r.stats.avgLossR)}</td>
                <td
                  className={cn(
                    "num px-3 py-2 text-right text-xs font-semibold",
                    r.stats.expectancyR >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {fmtR(r.stats.expectancyR)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </section>
  );
}

/**
 * Honest empty state. "Needs N more samples" tells the trader exactly what
 * unlocks the view, instead of showing a chart drawn from two data points.
 */
function NeedsSamples({ have, need, what }: { have: number; need: number; what: string }) {
  const missing = Math.max(0, need - have);
  return (
    <div className="mt-4 grid place-items-center rounded-md border border-dashed border-border px-6 py-14 text-center">
      <p className="num text-sm font-semibold text-foreground">
        Needs {missing} more sample{missing === 1 ? "" : "s"}
      </p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        {have} of {need} closed B-Grade-or-better results recorded. {what.charAt(0).toUpperCase() + what.slice(1)}{" "}
        drawn from fewer samples would be noise, so it stays hidden until the data supports it.
      </p>
    </div>
  );
}
