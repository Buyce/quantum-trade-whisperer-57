/**
 * Admin Intelligence & Telemetry Terminal (owner only).
 *
 * Isolation notes:
 * - One RPC per refresh; polling is a deliberate 60s interval with
 *   `refetchOnWindowFocus` off, so an idle open tab costs one read per minute.
 * - The whole panel is a lazily code-split route, so standard users never
 *   download this bundle.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { getAdminIntelligence } from "@/lib/admin.functions";
import { getWeeklyShadowReport } from "@/lib/reports/weekly.functions";
import { getUserReportAudit } from "@/lib/user-audit.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AuthorSplitPanel,
  DedupPanel,
  DisciplinePanel,
  EmptyNote,
  FillTable,
  GradeTable,
  InstrumentHealthList,
  IntersectionTable,
  PanelShell,
  RegimeTable,
  StatCard,
  UserIntegrityPanel,
  WebhookPanel,
  WeeklyTierPanel,
  num,
  pctOf,
  timeAgo,
} from "@/components/admin/AdminPanels";
import { BaselinePanel } from "@/components/admin/BaselinePanel";
import { ResearchPanel } from "@/components/admin/ResearchPanel";
import { PayoffPanel } from "@/components/admin/PayoffPanel";
import { CandidatePanel } from "@/components/admin/CandidatePanel";


export const Route = createFileRoute("/_authenticated/admin/intelligence")({
  head: () => ({
    meta: [
      { title: "Admin Intelligence Terminal | P-Trades Hub" },
      {
        name: "description",
        content:
          "Owner-only telemetry terminal: scanner heartbeat, Bayesian learning gates, fill diagnostics and per-signal user intersection data.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Admin Intelligence Terminal | P-Trades Hub" },
      {
        property: "og:description",
        content: "Owner-only telemetry terminal for the P-Trades Hub scanner and learning engine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminIntelligencePage,
});

function AdminIntelligencePage() {
  const fetchIntel = useServerFn(getAdminIntelligence);
  const fetchWeekly = useServerFn(getWeeklyShadowReport);
  const fetchAudit = useServerFn(getUserReportAudit);
  const weekly = useQuery({
    queryKey: ["admin-weekly-shadow-report"],
    queryFn: () => fetchWeekly(),
    refetchInterval: 300_000,
    refetchOnWindowFocus: false,
    staleTime: 240_000,
  });
  const audit = useQuery({
    queryKey: ["admin-user-report-audit"],
    queryFn: () => fetchAudit(),
    refetchInterval: 300_000,
    refetchOnWindowFocus: false,
    staleTime: 240_000,
  });
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-intelligence"],
    queryFn: () => fetchIntel(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 45_000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-3 p-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <PanelShell title="Terminal unavailable">
          <EmptyNote>{error instanceof Error ? error.message : "Failed to load intelligence."}</EmptyNote>
        </PanelShell>
      </div>
    );
  }

  const { health, engagement, fill_diagnostic, learning_matrix, discipline, webhooks, grade_calibration, dedup_pressure, intersection_feed } =
    data;
  const engine = health.engine;
  const jobTotal = Object.values(health.jobs ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-3 p-3 md:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Admin Intelligence Terminal</h1>
          <p className="text-[11px] text-muted-foreground">
            Live aggregates · generated {timeAgo(data.generated_at)} · auto-refresh 60s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
          Refresh
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Scan engine"
          value={engine?.paused ? "PAUSED" : "RUNNING"}
          sub={`last run ${timeAgo(engine?.last_run_at ?? null)}`}
          tone={engine?.paused ? "bad" : "good"}
        />
        <StatCard
          label="Consecutive failures"
          value={String(engine?.consecutive_failures ?? 0)}
          sub={engine?.last_error ? engine.last_error.slice(0, 60) : "no recent error"}
          tone={(engine?.consecutive_failures ?? 0) > 0 ? "warn" : "good"}
        />
        <StatCard
          label="Cycle latency p50 / p95"
          value={`${num(health.p50_ms, 0)} / ${num(health.p95_ms, 0)} ms`}
          sub={`${jobTotal} jobs in 24h · last ${timeAgo(health.last_cycle_at)}`}
        />
        <StatCard
          label="Active accounts"
          value={String(engagement.active_accounts)}
          sub={`${engagement.telemetry_events} telemetry events`}
        />
        <StatCard
          label="Taken / Skipped"
          value={`${engagement.total_taken} / ${engagement.total_skipped}`}
          sub="all-time user decisions"
        />
        <StatCard
          label="Taken → shadow win rate"
          hint="Deterministic replay outcome for setups users marked taken — not user-reported."
          value={pctOf(engagement.taken_performance?.win_rate ?? null)}
          sub={
            engagement.taken_performance && engagement.taken_performance.n > 0
              ? `n=${engagement.taken_performance.n} · mean R ${num(engagement.taken_performance.mean_r)}`
              : "no resolved taken signals"
          }
        />
        <StatCard
          label="User-reported win rate"
          hint="From users' own logged trade outcomes in Trade History."
          value={
            engagement.user_reported && engagement.user_reported.n > 0
              ? pctOf(engagement.user_reported.win_rate)
              : "—"
          }
          sub={
            engagement.user_reported && engagement.user_reported.n > 0
              ? `n=${engagement.user_reported.n} · mean R ${num(engagement.user_reported.mean_r)}` +
                (audit.data && audit.data.verifiedSampleN > 0
                  ? ` · verified ${pctOf(audit.data.verifiedWinRate)} (n=${audit.data.verifiedSampleN})`
                  : audit.data
                    ? " · none verified against replay"
                    : "")
              : "no user-logged outcomes yet"
          }
        />
        <StatCard
          label="Queue backlog"
          value={`${health.backlog?.pending ?? 0} pending`}
          sub={
            health.backlog?.oldest_pending_age_min != null
              ? `oldest ${health.backlog.oldest_pending_age_min} min · ${health.backlog.processing} in flight`
              : `queue clear · ${health.backlog?.processing ?? 0} in flight`
          }
          tone={
            (health.backlog?.oldest_pending_age_min ?? 0) > 15
              ? "bad"
              : (health.backlog?.pending ?? 0) > 0
                ? "warn"
                : "good"
          }
        />
        <StatCard
          label="Webhook success 24h"
          value={pctOf(webhooks.success_rate)}
          sub={`${webhooks.total_24h} dispatches`}
          tone={webhooks.success_rate != null && webhooks.success_rate < 0.9 ? "bad" : "default"}
        />
        <StatCard
          label="Regime buckets"
          value={String(learning_matrix.length)}
          sub="tiers 1–3 from regime_stats"
        />

      </section>

      <div className="grid gap-3 lg:grid-cols-3">
        <PanelShell title="Instrument health">
          <InstrumentHealthList health={health} />
        </PanelShell>
        <PanelShell
          title="Scan results 24h"
          right={<Badge variant="secondary" className="text-[10px]">{jobTotal} jobs</Badge>}
        >
          {Object.keys(health.results ?? {}).length === 0 ? (
            <EmptyNote>No scan cycles completed in the last 24 hours.</EmptyNote>
          ) : (
            <ul className="space-y-1 text-[11px] font-mono">
              {Object.entries(health.results).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-muted-foreground">{k}</span>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          )}
        </PanelShell>
        <PanelShell title="Structure cooldown pressure">
          <DedupPanel dedup={dedup_pressure} />
        </PanelShell>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <PanelShell title="Live fill diagnostic by session">
          <div className="space-y-3">
            <FillTable label="Rolling 24h" rows={fill_diagnostic.h24} />
            <FillTable label="Rolling 7d" rows={fill_diagnostic.d7} />
          </div>
        </PanelShell>
        <PanelShell title="Discipline index — shadow replay outcome (skipped vs taken)">
          <DisciplinePanel discipline={discipline} />
        </PanelShell>
      </div>

      <PanelShell title="Quantitative integrity baseline — immutable, pinned to one learning run">
        <BaselinePanel />
      </PanelShell>

      <PanelShell title="Grading research ledger — model v1 (live) vs model v2 (shadow)">
        <ResearchPanel />
      </PanelShell>

      <PanelShell title="Expected R research — payoff distribution, not probability">
        <PayoffPanel />

        <CandidatePanel />

      </PanelShell>


      <PanelShell title="Human vs AI agent — accounts, decisions and reported outcomes">
        <AuthorSplitPanel split={data.author_split} />
      </PanelShell>

      <PanelShell title="User-reported data integrity — checked against deterministic replay">
        {audit.isError ? (
          <EmptyNote>
            {audit.error instanceof Error ? audit.error.message : "Integrity audit unavailable."}
          </EmptyNote>
        ) : (
          <UserIntegrityPanel report={audit.data} />
        )}
      </PanelShell>



      <div className="grid gap-3 lg:grid-cols-3">
        <PanelShell title="Grade calibration">
          <GradeTable rows={grade_calibration} />
        </PanelShell>
        <PanelShell title="Webhook dispatch reliability">
          <WebhookPanel webhooks={webhooks} />
        </PanelShell>
        <PanelShell title="Volume by instrument">
          {engagement.by_instrument.length === 0 ? (
            <EmptyNote>No user decisions logged yet.</EmptyNote>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <tbody>
                {engagement.by_instrument.map((i) => (
                  <tr key={i.instrument} className="border-b border-border/50">
                    <td className="py-1">{i.instrument}</td>
                    <td className="py-1 text-right text-emerald-400">{i.taken}</td>
                    <td className="py-1 text-right text-muted-foreground">{i.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PanelShell>
      </div>

      <PanelShell
        title="Weekly shadow comparison — A/A+ vs B/C"
        right={
          <Badge variant="secondary" className="text-[10px]">
            {weekly.data ? `${weekly.data.isoWeek} · rolling 7d` : "loading"}
          </Badge>
        }
      >
        {weekly.isError ? (
          <EmptyNote>
            {weekly.error instanceof Error ? weekly.error.message : "Weekly report unavailable."}
          </EmptyNote>
        ) : weekly.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <WeeklyTierPanel report={weekly.data} />
        )}
      </PanelShell>

      <PanelShell title="Bayesian learning monitor">
        <RegimeTable rows={learning_matrix} />
      </PanelShell>

      <PanelShell
        title="Trade-by-trade intersection telemetry"
        right={<Badge variant="secondary" className="text-[10px]">last {intersection_feed.length}</Badge>}
      >
        <IntersectionTable rows={intersection_feed} />
      </PanelShell>
    </div>
  );
}
