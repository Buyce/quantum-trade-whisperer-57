/**
 * Signal audit dashboard — one row per scanned setup: its grade, how often it
 * was skipped or taken, and its shadow-engine enrolment / replay counts.
 *
 * ZERO-HALLUCINATION: with no scanned signals this renders an explicit empty
 * state. No placeholder rows, no example setups.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSignalAudit, type SignalAuditRow } from "@/lib/signal-audit.functions";
import { INSTRUMENT_LABELS } from "@/lib/db-types";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { InfoLabel } from "@/components/GuideMode";
import { cn } from "@/lib/utils";

const GRADE_TIERS = ["A+", "A", "B", "C"] as const;

const GRADE_TONE: Record<string, string> = {
  "A+": "text-chart-1",
  A: "text-success",
  B: "text-chart-3",
  C: "text-muted-foreground",
};

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SignalAudit() {
  const fetchAudit = useServerFn(getSignalAudit);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["signal-audit", 200],
    queryFn: () => fetchAudit({ data: { limit: 200 } }),
    staleTime: 60_000,
  });
  const [grade, setGrade] = useState<"all" | (typeof GRADE_TIERS)[number]>("all");

  const rows = data ?? [];

  const tiers = useMemo(
    () =>
      GRADE_TIERS.map((tier) => {
        const inTier = rows.filter((r) => r.grade === tier);
        return {
          tier,
          count: inTier.length,
          skipped: inTier.reduce((a, r) => a + r.skippedCount, 0),
          taken: inTier.reduce((a, r) => a + r.takenCount, 0),
          enrolled: inTier.reduce((a, r) => a + r.shadowEnrolments, 0),
          resolved: inTier.reduce((a, r) => a + r.shadowResolved, 0),
        };
      }),
    [rows],
  );

  const visible = useMemo(
    () => (grade === "all" ? rows : rows.filter((r) => r.grade === grade)),
    [rows, grade],
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  if (isError) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
        Could not load the signal audit. Reload before drawing conclusions from it.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-md border border-border bg-card p-6 text-center">
        <h2 className="text-sm font-semibold text-foreground">No scanned setups yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The audit lists real setups only. As soon as the scanner publishes a graded setup it appears here with
          its skip and shadow-engine counts.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
        {tiers.map((t) => (
          <button
            key={t.tier}
            type="button"
            onClick={() => setGrade(grade === t.tier ? "all" : t.tier)}
            className={cn(
              "bg-card px-3 py-3 text-left transition-colors hover:bg-accent/40",
              grade === t.tier && "bg-accent/60",
            )}
          >
            <p className="label-xs">{t.tier === "A+" ? "A+ Grade" : `${t.tier}-Grade`}</p>
            <p className={cn("num text-xl font-bold", GRADE_TONE[t.tier])}>{t.count}</p>
            <p className="num mt-1 text-[11px] text-muted-foreground">
              {t.skipped} skipped · {t.taken} taken
            </p>
            <p className="num text-[11px] text-muted-foreground">
              {t.enrolled} shadow · {t.resolved} resolved
            </p>
          </button>
        ))}
      </div>

      <section className="rounded-md border border-border bg-card">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="label-xs">
            <InfoLabel hint="Every scanned setup with its grade, the decisions users logged against it, and how many times the shadow engine enrolled and replayed it.">
              Per-signal audit
            </InfoLabel>
          </h2>
          <span className="num text-xs text-muted-foreground">
            {visible.length} of {rows.length} setups
          </span>
          {grade !== "all" ? (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setGrade("all")}>
              Clear {grade} filter
            </Button>
          ) : null}
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <Th className="text-left">Detected</Th>
                <Th className="text-left">Instrument</Th>
                <Th>Grade</Th>
                <Th>Dir</Th>
                <Th>Conf.</Th>
                <Th>Status</Th>
                <Th>Skipped</Th>
                <Th>Taken</Th>
                <Th>Shadow enrolled</Th>
                <Th>Replays resolved</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <Row key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("label-xs px-3 py-2 text-center whitespace-nowrap", className)}>{children}</th>;
}

function Row({ row }: { row: SignalAuditRow }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="num px-3 py-2 whitespace-nowrap text-muted-foreground">{when(row.detectedAt)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="font-semibold text-foreground">{row.instrument}</span>{" "}
        <span className="text-xs text-muted-foreground">{INSTRUMENT_LABELS[row.instrument] ?? ""}</span>
      </td>
      <td className={cn("px-3 py-2 text-center font-bold", GRADE_TONE[row.grade])}>{row.grade}</td>
      <td className="px-3 py-2 text-center text-xs uppercase text-muted-foreground">{row.direction}</td>
      <td className="num px-3 py-2 text-center">
        {row.confidenceScore == null ? "—" : row.confidenceScore.toFixed(0)}
      </td>
      <td className="px-3 py-2 text-center text-xs text-muted-foreground">{row.status}</td>
      <td className="num px-3 py-2 text-center">{row.skippedCount}</td>
      <td className="num px-3 py-2 text-center">{row.takenCount}</td>
      <td className="num px-3 py-2 text-center">
        {row.shadowEnrolments}
        {row.shadowStatus ? (
          <span className="ml-1 text-[10px] text-muted-foreground">({row.shadowStatus})</span>
        ) : null}
      </td>
      <td className="num px-3 py-2 text-center">
        {row.shadowResolved}
        {row.shadowExecutions > row.shadowResolved ? (
          <span className="ml-1 text-[10px] text-muted-foreground">/{row.shadowExecutions}</span>
        ) : null}
      </td>
    </tr>
  );
}
