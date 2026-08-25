import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
  samplesFromBrokerEvidence,
  samplesFromTrades,
} from "@/lib/performance";
import { getAutomaticOrderSummary, getBrokerPerformanceEvidence } from "@/lib/performance.functions";
import type { AutomaticOrderSummary } from "@/lib/automatic-order-summary";
import type { RBasis } from "@/lib/journal/r-math";
import { downloadCsv, samplesToCsv, todayStamp } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GuideNote, InfoLabel } from "@/components/GuideMode";
import { LearningHistory } from "@/components/LearningHistory";
import { SignalAudit } from "@/components/SignalAudit";
import { cn } from "@/lib/utils";
import { MIN_GROUP_CLUSTERS, MIN_GROUP_SAMPLES } from "@/lib/stats/evidence";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({
    meta: [
      { title: "Performance Engine — P-Trades Hub" },
      {
        name: "description",
        content:
          "Source-separated R performance for the self-reported journal, customer broker evidence and the controlled P-Trades benchmark.",
      },
      { property: "og:title", content: "Performance Engine — P-Trades Hub" },
      {
        property: "og:description",
        content: "Provenance-labelled R-multiple expectancy analytics.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PerformancePage,
});

const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
const GRADE_TIERS = ["A+", "A", "B", "C", "Unknown"] as const;
/**
 * Below these counts a chart is noise dressed as analysis, so we say what is
 * missing instead of drawing an empty grid.
 */
const MIN_SAMPLES_CHART = 5;
const MIN_SAMPLES_HEATMAP = 10;

type PerformanceSource = "journal" | "broker" | "benchmark";

const SOURCE_META: Record<
  PerformanceSource,
  { label: string; provenance: string; scopeLabel: string; description: string; empty: string }
> = {
  journal: {
    label: "My Journal",
    provenance: "SELF-REPORTED JOURNAL",
    scopeLabel: "Your self-reported journal",
    description:
      "Prices entered by you or your assistant. These rows are not broker verified and never enter either broker population.",
    empty:
      "No closed journal rows have the selected R basis. Log a taken trade and its real prices to build this source.",
  },
  broker: {
    label: "Broker Account",
    provenance: "CUSTOMER BROKER EVIDENCE",
    scopeLabel: "Your connected-account broker evidence",
    description:
      "Only closed broker deals positively associated with P-Trades orders on your connected accounts. This is your evidence, not the benchmark.",
    empty:
      "No closed, positively associated customer broker evidence has the selected R basis. Nothing else is substituted.",
  },
  benchmark: {
    label: "P-Trades Benchmark",
    provenance: "CONTROLLED BENCHMARK",
    scopeLabel: "The controlled P-Trades benchmark",
    description:
      "Only actual broker evidence from the dedicated P-Trades demo benchmark policy. It is not live trading and it is not scanner replay.",
    empty:
      "No closed controlled-benchmark broker evidence has the selected R basis. Scanner replay is not used as a fallback.",
  },
};

function PerformancePage() {
  const { user } = useAuth();
  const signals = useQuery(signalsQuery());
  const trades = useQuery(myTradesQuery(user?.id));
  const loadEvidence = useServerFn(getBrokerPerformanceEvidence);
  const loadAutomaticOrders = useServerFn(getAutomaticOrderSummary);
  const [scope, setScope] = useState<PerformanceSource>("journal");
  const [rBasis, setRBasis] = useState<RBasis>("actual_risk");
  const customerEvidence = useQuery({
    queryKey: ["performance-evidence", "customer"],
    queryFn: () => loadEvidence({ data: { source: "customer" } }),
    enabled: Boolean(user),
  });
  const benchmarkEvidence = useQuery({
    queryKey: ["performance-evidence", "benchmark"],
    queryFn: () => loadEvidence({ data: { source: "benchmark" } }),
    enabled: Boolean(user),
  });
  const automaticOrders = useQuery({
    queryKey: ["automatic-order-summary"],
    queryFn: () => loadAutomaticOrders(),
    enabled: Boolean(user) && scope === "broker",
  });

  const journal = useMemo(
    () => samplesFromTrades(trades.data ?? [], signals.data ?? [], rBasis),
    [trades.data, signals.data, rBasis],
  );
  const broker = useMemo(
    () => samplesFromBrokerEvidence(customerEvidence.data ?? [], rBasis),
    [customerEvidence.data, rBasis],
  );
  const benchmark = useMemo(
    () => samplesFromBrokerEvidence(benchmarkEvidence.data ?? [], rBasis),
    [benchmarkEvidence.data, rBasis],
  );
  const samples = scope === "journal" ? journal : scope === "broker" ? broker : benchmark;
  const sourceMeta = SOURCE_META[scope];
  const scopeLabel = sourceMeta.scopeLabel;

  // The headline population follows the configured B-or-better reporting scope:
  // C is excluded from KPIs, insights, distribution and heat map, but remains in
  // the explicitly tiered table. This filter is not a claim that an edge exists.
  const coreSamples = useMemo(
    () => samples.filter((s) => s.grade !== "C" && s.grade !== "Unknown"),
    [samples],
  );

  const stats = useMemo(() => computeExpectancy(coreSamples), [coreSamples]);
  const distinctDays = useMemo(
    () => new Set(coreSamples.map((sample) => sample.detectedAt.slice(0, 10))).size,
    [coreSamples],
  );
  const mature = stats.count >= MIN_GROUP_SAMPLES && distinctDays >= MIN_GROUP_CLUSTERS;
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

  const insights = useMemo(
    () => generateInsights(coreSamples, scopeLabel),
    [coreSamples, scopeLabel],
  );

  function exportMetrics() {
    if (samples.length === 0) return;
    downloadCsv(
      `ptrades_performance_${scope}_${rBasis}_${todayStamp()}.csv`,
      samplesToCsv(samples, { provenance: sourceMeta.provenance, rBasis }),
    );
  }

  const maxAbs = Math.max(0.01, ...cells.map((c) => Math.abs(c.expectancyR)));

  if (
    signals.isLoading ||
    trades.isLoading ||
    customerEvidence.isLoading ||
      benchmarkEvidence.isLoading ||
      (scope === "broker" && automaticOrders.isLoading)
  ) {
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
          <p className="label-xs">Source-separated evidence</p>
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Performance
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          <Tabs value={scope} onValueChange={(v) => setScope(v as PerformanceSource)}>
            <TabsList className="grid h-auto w-full grid-cols-3 sm:inline-flex sm:w-auto">
              <TabsTrigger value="journal">My Journal</TabsTrigger>
              <TabsTrigger value="broker">Broker Account</TabsTrigger>
              <TabsTrigger value="benchmark">P-Trades Benchmark</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="ghost" disabled={samples.length === 0} onClick={exportMetrics}>
            <Download className="size-4" /> Export Metrics (CSV)
          </Button>
        </div>
      </div>

      <GuideNote anchor="expectancy">
        Expectancy in R is (win rate x average win in R) − (loss rate x average loss in R): the
        average risk-multiple this sample produced. It describes these trades, not your next one. My
        Journal, Broker Account and P-Trades Benchmark are separate populations and are never
        combined. Scanner replay is research evidence and is not a Performance source.
      </GuideNote>

      {signals.isError ||
      trades.isError ||
      customerEvidence.isError ||
      benchmarkEvidence.isError ||
      automaticOrders.isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Could not load performance data, so the metrics below are incomplete. Reload before
          drawing conclusions from them.
        </p>
      ) : null}

      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px] tracking-wide">
            {sourceMeta.provenance}
          </Badge>
          <span className="text-sm font-medium">{sourceMeta.label}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {sourceMeta.description}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="label-xs">R basis</span>
          <Tabs value={rBasis} onValueChange={(value) => setRBasis(value as RBasis)}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="actual_risk">R vs actual risk</TabsTrigger>
              <TabsTrigger value="plan">R vs plan</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Only rows with {rBasis === "plan" ? "r_vs_plan" : "r_vs_actual_risk"} are included. The
          two R bases are never averaged or filled from one another.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="font-mono text-[10px]">
            {mature ? "DESCRIPTIVE GATE MET" : "IMMATURE SAMPLE"}
          </Badge>
          <span>
            {stats.count}/{MIN_GROUP_SAMPLES} closed rows · {distinctDays}/{MIN_GROUP_CLUSTERS} UTC
            days. Point estimates describe this sample; the gate does not make them predictive.
          </span>
        </div>
      </section>

      {scope === "broker" ? (
        <AutomaticOrderSummaryPanel summary={automaticOrders.data ?? null} basis={rBasis} />
      ) : null}

      {samples.length === 0 ? (
        <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {sourceMeta.empty}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label="Expectancy / trade"
          hint="Arithmetic mean R in this selected sample. +0.30R means its total R divided by its closed-row count was +0.30; it is not a future-return estimate."
          value={fmtR(stats.expectancyR)}
          tone={stats.expectancyR > 0 ? "pos" : stats.expectancyR < 0 ? "neg" : undefined}
        />
        <Kpi
          label="Win rate"
          hint="Share of selected canonical R values above zero. The sign of R is authoritative even if a self-reported journal label disagrees."
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
          hint="Average absolute magnitude of negative-R rows. It is shown as a positive loss size and subtracted in the expectancy formula."
          value={fmtR(stats.avgLossR)}
          tone="neg"
        />
        <Kpi
          label="Total R"
          hint="Signed R values added across this selected basis. It cannot be converted to currency from one current risk setting when per-trade risk amounts differed."
          value={fmtR(stats.totalR)}
          tone={stats.totalR >= 0 ? "pos" : "neg"}
        />
        <Kpi
          label="Closed setups"
          hint={`Rows with a recorded result and the selected R basis. Maturity requires at least ${MIN_GROUP_SAMPLES} rows across ${MIN_GROUP_CLUSTERS} UTC days.`}
          value={String(stats.count)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Global metrics above reflect broker/signal-identified B-Grade and above. C-Grade and rows
        whose retained signal grade is unavailable are excluded from the global metrics and shown
        separately in the “By grade tier” table below.
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
          <TabsTrigger className="h-10 lg:h-auto" value="distribution">
            R distribution
          </TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="timing">
            Timing
          </TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="instrument">
            By instrument
          </TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="grade">
            By grade
          </TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="signals">
            Signal audit
          </TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="learning">
            Learning
          </TabsTrigger>
        </TabsList>

        <TabsContent value="distribution">
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="label-xs">R-multiple distribution</h2>
            {coreSamples.length < MIN_SAMPLES_CHART ? (
              <NeedsSamples
                have={coreSamples.length}
                need={MIN_SAMPLES_CHART}
                what="a distribution"
              />
            ) : (
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dist}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis dataKey="bucket" stroke="var(--color-muted-foreground)" fontSize={11} />
                    <YAxis
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      allowDecimals={false}
                    />
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
              <NeedsSamples
                have={coreSamples.length}
                need={MIN_SAMPLES_HEATMAP}
                what="a time-of-day map"
              />
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
                          const alpha =
                            cell && cell.count > 0 ? Math.min(0.85, Math.abs(v) / maxAbs) : 0;
                          const color =
                            v >= 0 ? "var(--color-success)" : "var(--color-destructive)";
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
              label:
                g.key === "Unknown"
                  ? "Grade unavailable"
                  : g.key === "A+"
                    ? "A+ Grade"
                    : `${g.key}-Grade`,
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

function AutomaticOrderSummaryPanel({
  summary,
  basis,
}: {
  summary: AutomaticOrderSummary | null;
  basis: RBasis;
}) {
  const rStats = basis === "plan" ? summary?.closedPlan : summary?.closedActualRisk;
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px] tracking-wide">
          AUTOMATIC BROKER ORDERS
        </Badge>
        <span className="text-sm font-medium">Delivery accounting</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Delivery rows count P-Trades attempts and broker submissions. Win/loss counts come only
        from closed broker evidence with the selected R basis; blocked checks and dry runs stay out.
      </p>
      <div className="mt-4 grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCell label="Delivery rows" value={summary?.deliveryRows ?? 0} />
        <SummaryCell label="Blocked before broker" value={summary?.blockedBeforeBroker ?? 0} />
        <SummaryCell label="Submitted to broker" value={summary?.submittedToBroker ?? 0} />
        <SummaryCell label="Broker open" value={summary?.brokerOpen ?? 0} />
        <SummaryCell label="Broker closed" value={summary?.brokerClosed ?? 0} />
        <SummaryCell label="Dry runs" value={summary?.dryRuns ?? 0} />
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>
          Closed broker R: {rStats?.wins ?? 0} win, {rStats?.losses ?? 0} loss,{" "}
          {rStats?.breakeven ?? 0} breakeven
        </span>
        {(rStats?.unavailable ?? 0) > 0 ? (
          <span>{rStats?.unavailable ?? 0} closed broker rows have no selected R basis.</span>
        ) : null}
      </div>
    </section>
  );
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 bg-card px-3 py-3">
      <p className="label-xs">{label}</p>
      <p className="num mt-1 text-lg font-bold text-foreground">{value}</p>
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
                  <td className="num px-3 py-2 text-right text-xs text-success">
                    {fmtR(r.stats.avgWinR)}
                  </td>
                  <td className="num px-3 py-2 text-right text-xs text-destructive">
                    {fmtR(r.stats.avgLossR)}
                  </td>
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
        {have} of {need} closed B-Grade-or-better results recorded.{" "}
        {what.charAt(0).toUpperCase() + what.slice(1)} drawn from fewer samples would be noise, so
        it stays hidden until the data supports it.
      </p>
    </div>
  );
}
