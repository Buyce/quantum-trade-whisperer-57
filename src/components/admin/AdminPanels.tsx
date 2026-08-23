/**
 * Presentation-only pieces of the admin intelligence terminal.
 *
 * Every value shown here is an aggregate returned by
 * `public.get_admin_intelligence()`. Nothing is invented: zero renders as zero
 * and thin samples render an explicit "not enough data" line.
 */
import type {
  AdminDedup,
  AdminAuthorSplit,
  AdminDiscipline,
  AdminFeedRow,
  AdminFillRow,
  AdminGradeRow,
  AdminHealth,
  AdminRegimeRow,
  AdminWebhooks,
} from "@/lib/admin.functions";
import type { WeeklyReport } from "@/lib/reports/weekly";
import type { UserAuditReport } from "@/lib/user-audit.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const MIN_DISCIPLINE_SAMPLES = 20;

function num(v: number | null | undefined, digits = 2) {
  return v == null ? "—" : Number(v).toFixed(digits);
}

function pctOf(v: number | null | undefined) {
  return v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`;
}

function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function StatCard({
  label,
  value,
  sub,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  /** Hover clarification for ambiguous metrics. */
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <Card className="p-3">
      <p
        className={cn(
          "text-[10px] uppercase tracking-wider text-muted-foreground",
          hint && "cursor-help decoration-dotted underline-offset-4 hover:underline",
        )}
        title={hint}
      >
        {label}
      </p>
      <p className={cn("mt-1 font-mono text-xl leading-none", toneClass)}>{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{children}</p>;
}

export function PanelShell({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </Card>
  );
}

export function InstrumentHealthList({ health }: { health: AdminHealth }) {
  if (!health.instruments.length)
    return <EmptyNote>No instrument health rows recorded yet.</EmptyNote>;
  return (
    <ul className="space-y-1">
      {health.instruments.map((i) => (
        <li key={i.instrument} className="flex items-center justify-between text-xs">
          <span className="font-mono">{i.instrument}</span>
          <span className="flex items-center gap-2">
            {i.unavailable_until ? (
              <span className="text-muted-foreground">until {timeAgo(i.unavailable_until)}</span>
            ) : null}
            <Badge variant={i.available ? "secondary" : "destructive"} className="text-[10px]">
              {i.available ? "available" : "down"}
            </Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RegimeTable({ rows }: { rows: AdminRegimeRow[] }) {
  if (!rows.length)
    return <EmptyNote>The learning engine has not produced regime statistics yet.</EmptyNote>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1 pr-2 font-medium">Regime</th>
            <th className="py-1 pr-2 font-medium">T</th>
            <th className="py-1 pr-2 text-right font-medium">N</th>
            <th className="py-1 pr-2 text-right font-medium">Filled</th>
            <th className="py-1 pr-2 text-right font-medium">P(fill)</th>
            <th className="py-1 pr-2 text-right font-medium">P(win)</th>
            <th className="py-1 pr-2 font-medium">Fill gate ≥150</th>
            <th className="py-1 font-medium">Win gate ≥200</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={`${r.tier}-${r.regime_key}`} className="border-b border-border/50">
              <td className="py-1 pr-2 max-w-[220px] truncate" title={r.regime_key}>
                {r.regime_key}
              </td>
              <td className="py-1 pr-2 text-muted-foreground">{r.tier}</td>
              <td className="py-1 pr-2 text-right">{r.n_total}</td>
              <td className="py-1 pr-2 text-right">{r.n_filled}</td>
              <td className="py-1 pr-2 text-right">
                {num(r.p_fill_shrunk, 3)}
                <span className="ml-1 text-muted-foreground">({num(r.p_fill_raw, 3)})</span>
              </td>
              <td className="py-1 pr-2 text-right">
                {num(r.p_win_shrunk, 3)}
                <span className="ml-1 text-muted-foreground">({num(r.p_win_raw, 3)})</span>
              </td>
              <td className="py-1 pr-2">
                <span className="flex items-center gap-1">
                  <Progress value={r.fill_gate_pct} className="h-1 w-16" />
                  <span
                    className={r.fill_gate_passed ? "text-emerald-400" : "text-muted-foreground"}
                  >
                    {r.fill_gate_pct}%
                  </span>
                </span>
              </td>
              <td className="py-1">
                <span className="flex items-center gap-1">
                  <Progress value={r.win_gate_pct} className="h-1 w-16" />
                  <span
                    className={r.win_gate_passed ? "text-emerald-400" : "text-muted-foreground"}
                  >
                    {r.win_gate_pct}%
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Shrunk value first, raw empirical rate in brackets. Probabilities stay advisory until a gate
        passes.
      </p>
    </div>
  );
}

export function FillTable({ label, rows }: { label: string; rows: AdminFillRow[] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {rows.length === 0 ? (
        <EmptyNote>No resolved shadow rows in this window.</EmptyNote>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1 pr-2 font-medium">Session</th>
              <th className="py-1 pr-2 text-right font-medium">N</th>
              <th className="py-1 pr-2 text-right font-medium">Fill %</th>
              <th className="py-1 text-right font-medium">Median miss (ATR)</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r) => {
              const rate = r.n === 0 ? null : r.filled / r.n;
              return (
                <tr key={r.sess} className="border-b border-border/50">
                  <td className="py-1 pr-2">{r.sess}</td>
                  <td className="py-1 pr-2 text-right">{r.n}</td>
                  <td
                    className={cn(
                      "py-1 pr-2 text-right",
                      rate != null && rate >= 0.6
                        ? "text-emerald-400"
                        : rate != null && rate < 0.3
                          ? "text-destructive"
                          : "",
                    )}
                  >
                    {pctOf(rate)}
                  </td>
                  <td className="py-1 text-right">{num(r.median_miss_atr, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function DisciplinePanel({ discipline }: { discipline: AdminDiscipline }) {
  if (!discipline.sufficient) {
    return (
      <EmptyNote>
        Insufficient samples (&lt;{MIN_DISCIPLINE_SAMPLES}). {discipline.total_decisions} decision
        {discipline.total_decisions === 1 ? "" : "s"} logged so far — the comparison is suppressed
        until it would mean something.
      </EmptyNote>
    );
  }
  const sides = [
    { key: "Taken", side: discipline.taken },
    { key: "Skipped", side: discipline.skipped },
  ];
  const edge =
    discipline.skipped.win_rate != null && discipline.taken.win_rate != null
      ? discipline.skipped.win_rate - discipline.taken.win_rate
      : null;
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px]">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1 pr-2 font-medium">Decision</th>
            <th className="py-1 pr-2 text-right font-medium">Decisions</th>
            <th
              className="py-1 pr-2 text-right font-medium cursor-help decoration-dotted underline-offset-4 hover:underline"
              title="Only filled replays count toward win rate and mean R."
            >
              Filled
            </th>

            <th className="py-1 pr-2 text-right font-medium">Win rate</th>
            <th className="py-1 text-right font-medium">Mean R</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {sides.map(({ key, side }) => (
            <tr key={key} className="border-b border-border/50">
              <td className="py-1 pr-2">{key}</td>
              <td className="py-1 pr-2 text-right">{side.n}</td>
              <td className="py-1 pr-2 text-right">{side.filled}</td>
              <td className="py-1 pr-2 text-right">{pctOf(side.win_rate)}</td>
              <td className="py-1 text-right">{num(side.mean_r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {edge != null ? (
        <p className="text-[11px] text-muted-foreground">
          {edge > 0
            ? `Skipped setups won ${(edge * 100).toFixed(1)}pp more often — users may be filtering out the best trades.`
            : `Taken setups won ${(Math.abs(edge) * 100).toFixed(1)}pp more often — the filtering is adding value.`}
        </p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Replay outcomes, not user-reported. Compare with the User-reported win rate tile above.
      </p>
    </div>
  );
}

export function GradeTable({ rows }: { rows: AdminGradeRow[] }) {
  if (!rows.length)
    return <EmptyNote>No resolved shadow executions to calibrate against yet.</EmptyNote>;
  return (
    <table className="w-full text-[11px]">
      <thead className="text-left text-muted-foreground">
        <tr className="border-b border-border">
          <th className="py-1 pr-2 font-medium">Grade</th>
          <th className="py-1 pr-2 text-right font-medium">N</th>
          <th className="py-1 pr-2 text-right font-medium">Win rate</th>
          <th className="py-1 pr-2 text-right font-medium">Mean R</th>
          <th className="py-1 text-right font-medium">Avg conf.</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {rows.map((r) => (
          <tr key={r.grade} className="border-b border-border/50">
            <td className="py-1 pr-2">{r.grade}</td>
            <td className="py-1 pr-2 text-right">
              {r.n}
              <span className="ml-1 text-muted-foreground">({r.filled}f)</span>
            </td>
            <td className="py-1 pr-2 text-right">{pctOf(r.win_rate)}</td>
            <td className="py-1 pr-2 text-right">{num(r.mean_r)}</td>
            <td className="py-1 text-right">{num(r.avg_confidence, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DedupPanel({ dedup }: { dedup: AdminDedup }) {
  const total = dedup.suppressed_24h + dedup.published_24h;
  const share = total === 0 ? null : dedup.suppressed_24h / total;
  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex justify-between font-mono">
        <span className="text-muted-foreground">Suppressed 24h</span>
        <span>{dedup.suppressed_24h}</span>
      </div>
      <div className="flex justify-between font-mono">
        <span className="text-muted-foreground">Suppressed 7d</span>
        <span>{dedup.suppressed_7d}</span>
      </div>
      <div className="flex justify-between font-mono">
        <span className="text-muted-foreground">Published 24h</span>
        <span>{dedup.published_24h}</span>
      </div>
      <p className="text-muted-foreground">
        {share == null
          ? "No scan cycles resolved to a publish or duplicate decision in the last 24h."
          : `${(share * 100).toFixed(0)}% of publish-eligible cycles were blocked by the structure cooldown.`}
      </p>
    </div>
  );
}

export function WebhookPanel({ webhooks }: { webhooks: AdminWebhooks }) {
  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex justify-between font-mono">
        <span className="text-muted-foreground">Dispatches 24h</span>
        <span>{webhooks.total_24h}</span>
      </div>
      <div className="flex justify-between font-mono">
        <span className="text-muted-foreground">p95 latency</span>
        <span>{webhooks.p95_latency_ms == null ? "—" : `${webhooks.p95_latency_ms} ms`}</span>
      </div>
      {webhooks.recent_errors.length === 0 ? (
        <p className="text-muted-foreground">No dispatch failures recorded.</p>
      ) : (
        <ul className="space-y-1">
          {webhooks.recent_errors.map((e, i) => (
            <li key={`${e.created_at}-${i}`} className="font-mono text-[10px] text-destructive">
              {new Date(e.created_at).toLocaleString()} · {e.http_status ?? "no status"} ·{" "}
              {e.error ?? "unknown error"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IntersectionTable({ rows }: { rows: AdminFeedRow[] }) {
  if (!rows.length) return <EmptyNote>No signals have been published yet.</EmptyNote>;
  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-card text-left text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1 pr-2 font-medium">Detected</th>
            <th className="py-1 pr-2 font-medium">Instr.</th>
            <th className="py-1 pr-2 font-medium">Dir</th>
            <th className="py-1 pr-2 font-medium">Gr</th>
            <th className="py-1 pr-2 font-medium">Session</th>
            <th className="py-1 pr-2 text-right font-medium">T/S</th>
            <th className="py-1 pr-2 font-medium">Replay</th>
            <th className="py-1 pr-2 text-right font-medium">R</th>
            <th className="py-1 text-right font-medium">Miss ATR</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/50">
              <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">
                {timeAgo(r.detected_at)}
              </td>
              <td className="py-1 pr-2">{r.instrument}</td>
              <td
                className={cn(
                  "py-1 pr-2",
                  r.direction === "long" ? "text-emerald-400" : "text-destructive",
                )}
              >
                {r.direction === "long" ? "L" : "S"}
              </td>
              <td className="py-1 pr-2">{r.grade}</td>
              <td className="py-1 pr-2 text-muted-foreground">{r.trading_session ?? "—"}</td>
              <td className="py-1 pr-2 text-right">
                {r.taken_count}/{r.skipped_count}
              </td>
              <td className="py-1 pr-2">
                {r.resolved_outcome ? (
                  <span
                    className={
                      r.resolved_outcome === "win"
                        ? "text-emerald-400"
                        : r.resolved_outcome === "loss"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {r.resolved_outcome}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{r.shadow_status ?? "not enrolled"}</span>
                )}
              </td>
              <td className="py-1 pr-2 text-right">{num(r.realized_r)}</td>
              <td className="py-1 text-right">{num(r.miss_distance_atr, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { timeAgo, num, pctOf };

/**
 * Weekly A/A+ vs B/C shadow comparison with significance testing.
 * Every figure is an aggregate over live shadow rows; an under-powered
 * comparison reports "insufficient" rather than a number.
 */
export function WeeklyTierPanel({ report }: { report: WeeklyReport | undefined }) {
  if (!report) return <EmptyNote>Weekly comparison unavailable.</EmptyNote>;
  if (report.totalResolved === 0) {
    return <EmptyNote>No shadow setups resolved in the last 7 days.</EmptyNote>;
  }

  const tiers = [report.high, report.low];
  return (
    <div className="space-y-3">
      <table className="w-full text-[11px] font-mono">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1 text-left">tier</th>
            <th className="py-1 text-right">resolved</th>
            <th className="py-1 text-right">filled</th>
            <th className="py-1 text-right">fill %</th>
            <th className="py-1 text-right">win %</th>
            <th className="py-1 text-right">mean R</th>
            <th className="py-1 text-right">total R</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <tr key={t.tier} className="border-b border-border/50">
              <td className="py-1">{t.label}</td>
              <td className="py-1 text-right">{t.resolved}</td>
              <td className="py-1 text-right">{t.filled}</td>
              <td className="py-1 text-right">{pctOf(t.fillRate)}</td>
              <td className="py-1 text-right">{pctOf(t.winRate)}</td>
              <td className="py-1 text-right">{num(t.meanR)}</td>
              <td className="py-1 text-right">{num(t.totalR)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="space-y-2 text-[11px]">
        {report.comparisons.map((c) => (
          <li key={c.metric} className="border-t border-border/50 pt-2">
            <div className="flex items-center justify-between gap-2 font-mono">
              <span>{c.label}</span>
              <Badge
                variant={c.verdict === "significant" ? "default" : "secondary"}
                className="text-[10px]"
              >
                {c.verdict.replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="mt-1 font-mono text-muted-foreground">
              A/A+ {pctOf(c.highRate)} (n={c.highN}) vs B/C {pctOf(c.lowRate)} (n={c.lowN}) · z{" "}
              {c.z === null ? "n/a" : c.z.toFixed(2)} · p{" "}
              {c.pValue === null ? "n/a" : c.pValue.toFixed(4)}
            </p>
            <p className="mt-0.5 text-muted-foreground">{c.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FLAG_LABELS: Record<string, string> = {
  never_filled_in_replay: "reported filled, replay never filled",
  r_exceeds_max_r: "R above the setup's structural maximum",
  preset_r_value: "R is a round preset, no prices behind it",
  logged_within_60s: "outcome stamped within 60s of the decision",
  no_prices_reported: "no entry/exit price logged",
  outcome_disagrees_with_replay: "outcome opposite to the replay",
  agent_entered_price: "prices entered by an AI assistant",
  no_replay_yet: "no resolved replay to check against",
};

const VERDICT_TONE: Record<string, string> = {
  verified: "text-emerald-400",
  unverifiable: "text-amber-400",
  contradicted: "text-destructive",
  pending: "text-muted-foreground",
};

/**
 * Integrity of user-reported outcomes. Every line is a comparison against the
 * deterministic replay or the setup's own geometry — no findings means no
 * findings, stated plainly.
 */
export function UserIntegrityPanel({ report }: { report: UserAuditReport | undefined }) {
  if (!report) return <EmptyNote>Loading integrity audit…</EmptyNote>;
  if (report.totals.trades === 0)
    return <EmptyNote>No user-logged taken trades to audit yet.</EmptyNote>;

  const t = report.totals;
  const flagged = report.rows.filter((r) => r.flags.length > 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono md:grid-cols-4">
        <IntegrityStat label="verified" value={String(t.verified)} tone="text-emerald-400" />
        <IntegrityStat label="unverifiable" value={String(t.unverifiable)} tone="text-amber-400" />
        <IntegrityStat
          label="contradicted"
          value={String(t.contradicted)}
          tone="text-destructive"
        />
        <IntegrityStat
          label="trust score"
          value={t.trustScore == null ? "—" : pctOf(t.trustScore)}
          tone={t.trustScore != null && t.trustScore < 0.7 ? "text-destructive" : "text-foreground"}
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t.resolved} resolved · {t.pending} still open · {t.withPrices} with real prices logged.
        Reported win rate {pctOf(report.reportedWinRate)} vs verified{" "}
        {pctOf(report.verifiedWinRate)} (n=
        {report.verifiedSampleN}, contradicted rows excluded).
      </p>

      {report.priceAuthors.length > 0 ? (
        <div className="space-y-1 rounded-sm border border-border px-2 py-1.5 text-[11px]">
          <p className="text-muted-foreground">Verified prices by author</p>
          {report.priceAuthors.map((a) => (
            <div
              key={`${a.source}-${a.client ?? ""}`}
              className="flex items-center justify-between gap-2"
            >
              <span className={a.source === "agent" ? "text-warning" : "text-muted-foreground"}>
                {a.source === "human"
                  ? "human · web terminal"
                  : a.source === "agent"
                    ? `agent · ${a.client ?? "unknown client"}`
                    : "unattributed (pre-provenance)"}
              </span>
              <span className="font-mono">{a.n}</span>
            </div>
          ))}
        </div>
      ) : null}

      {report.decisionAuthors.length > 0 ? (
        <div className="space-y-1 rounded-sm border border-border px-2 py-1.5 text-[11px]">
          <p className="text-muted-foreground">Logged trades by author</p>
          {report.decisionAuthors.map((a) => (
            <div
              key={`d-${a.source}-${a.client ?? ""}`}
              className="flex items-center justify-between gap-2"
            >
              <span className={a.source === "agent" ? "text-warning" : "text-muted-foreground"}>
                {a.source === "human"
                  ? "human · web terminal"
                  : `agent · ${a.client ?? "unknown client"}`}
              </span>
              <span className="font-mono">
                {a.trades} logged · {a.verified} verified · {a.contradicted} contradicted ·{" "}
                {a.winRate == null ? "—" : pctOf(a.winRate)} win
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {Object.keys(report.flagCounts).length > 0 ? (
        <ul className="space-y-1 text-[11px]">
          {Object.entries(report.flagCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([flag, count]) => (
              <li key={flag} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{FLAG_LABELS[flag] ?? flag}</span>
                <span className="font-mono">{count}</span>
              </li>
            ))}
        </ul>
      ) : null}

      {flagged.length === 0 ? (
        <EmptyNote>No integrity issues found in the logged trades.</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[11px] font-mono">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1 text-left">Setup</th>
                <th className="py-1 text-left">Author</th>
                <th className="py-1 text-right">Reported</th>
                <th className="py-1 text-right">Replay</th>
                <th className="py-1 text-right">max R</th>
                <th className="py-1 text-left">Verdict</th>
                <th className="py-1 text-left">Flags</th>
              </tr>
            </thead>
            <tbody>
              {flagged.slice(0, 60).map((r) => (
                <tr key={r.tradeId} className="border-b border-border/50 align-top">
                  <td className="py-1">
                    {r.instrument} {r.grade} {r.direction}
                    <span className="ml-1 text-muted-foreground">{timeAgo(r.detectedAt)}</span>
                  </td>
                  <td className="py-1">
                    <span className={r.decisionSource === "agent" ? "text-warning" : ""}>
                      {r.decisionSource}
                    </span>
                    {r.priceSource === "agent" ? (
                      <span className="ml-1 text-warning">(agent priced)</span>
                    ) : null}
                  </td>
                  <td className="py-1 text-right">
                    {r.outcome}
                    {r.reportedR != null ? ` ${num(r.reportedR)}R` : ""}
                  </td>
                  <td className="py-1 text-right">
                    {r.replayOutcome ?? "—"}
                    {r.replayOutcome === "never_filled" && r.missDistanceAtr != null
                      ? ` ${num(r.missDistanceAtr)} ATR`
                      : r.replayR != null
                        ? ` ${num(r.replayR)}R`
                        : ""}
                  </td>
                  <td className="py-1 text-right">{num(r.maxR)}</td>
                  <td className={cn("py-1", VERDICT_TONE[r.verdict])}>{r.verdict}</td>
                  <td className="py-1 text-muted-foreground">
                    {r.flags.map((f) => FLAG_LABELS[f] ?? f).join("; ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Observational only. The Bayesian learning engine trains exclusively on deterministic shadow
        replay labels and never reads user-reported outcomes.
      </p>
    </div>
  );
}

function IntegrityStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-sm border border-border px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm", tone)}>{value}</p>
    </div>
  );
}

/**
 * Human vs AI-agent split across accounts, decisions and reported outcomes.
 * Authorship is stamped server-side at write time, so these counts are the
 * real request paths — never a client claim.
 */
export function AuthorSplitPanel({ split }: { split: AdminAuthorSplit | null }) {
  if (!split) return <EmptyNote>No author data available yet.</EmptyNote>;

  const label = (source: string, clients: string[]) =>
    source === "agent"
      ? `agent${clients.length ? ` · ${clients.join(", ")}` : ""}`
      : "human · web terminal";

  return (
    <div className="space-y-3 text-[11px]">
      <div className="space-y-1">
        <p className="text-muted-foreground">Active accounts</p>
        {split.accounts.length === 0 ? (
          <EmptyNote>No active accounts yet.</EmptyNote>
        ) : (
          split.accounts.map((a) => (
            <div key={`acc-${a.source}`} className="flex items-center justify-between gap-2">
              <span className={a.source === "agent" ? "text-warning" : "text-muted-foreground"}>
                {label(a.source, a.clients)}
              </span>
              <span className="font-mono">{a.n}</span>
            </div>
          ))
        )}
      </div>

      <div className="space-y-1">
        <p className="text-muted-foreground">Taken / skipped decisions</p>
        {split.decisions.length === 0 ? (
          <EmptyNote>No decisions logged yet.</EmptyNote>
        ) : (
          split.decisions.map((d) => (
            <div key={`dec-${d.source}`} className="flex items-center justify-between gap-2">
              <span className={d.source === "agent" ? "text-warning" : "text-muted-foreground"}>
                {label(d.source, d.clients)}
              </span>
              <span className="font-mono">
                {d.taken} taken · {d.skipped} skipped
              </span>
            </div>
          ))
        )}
      </div>

      <div className="space-y-1">
        <p className="text-muted-foreground">User-reported outcomes</p>
        {split.user_reported.length === 0 ? (
          <EmptyNote>No resolved user-logged outcomes yet.</EmptyNote>
        ) : (
          split.user_reported.map((u) => (
            <div key={`rep-${u.source}`} className="flex items-center justify-between gap-2">
              <span className={u.source === "agent" ? "text-warning" : "text-muted-foreground"}>
                {u.source === "agent" ? "agent" : "human · web terminal"}
              </span>
              <span className="font-mono">
                n={u.n} · {pctOf(u.win_rate)} win · mean R {num(u.mean_r)}
              </span>
            </div>
          ))
        )}
      </div>

      <p className="text-muted-foreground">
        Authorship is stamped from the request path: the web terminal writes human, the MCP
        connection writes agent with its OAuth client id.
      </p>
    </div>
  );
}
