/**
 * V1 vs V2 research ledger (owner only).
 *
 * Read-only. V2 is a shadow model: nothing here changes what the terminal
 * publishes. Every row is one evaluation of one fetched observation, so the two
 * cohorts are directly comparable on the same candles.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical } from "lucide-react";
import { getResearchLedger, type ModelCohort } from "@/lib/research.functions";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyNote, num } from "./AdminPanels";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function Breakdown({ label, map }: { label: string; map: Record<string, number> }) {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      {entries.map(([k, v]) => (
        <Badge key={k} variant="outline" className="font-mono">
          {k} {num(v)}
        </Badge>
      ))}
    </div>
  );
}

function Cohort({ cohort }: { cohort: ModelCohort }) {
  const shadow = cohort.modelVersion !== 1;
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Model v{cohort.modelVersion}</div>
        <Badge variant={shadow ? "outline" : "secondary"}>
          {shadow ? "shadow / research" : "production"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Observations" value={num(cohort.observations)} />
        <Stat label="Candidates" value={num(cohort.candidates)} />
        <Stat label="No trade" value={num(cohort.noTrade)} />
        <Stat label="Errors" value={num(cohort.errors)} />
        <Stat label="Published" value={num(cohort.published)} />
        <Stat label="Observation only" value={num(cohort.observationOnly)} />
        <Stat label="Cooldown suppressed" value={num(cohort.suppressedCooldown)} />
        <Stat
          label="p95 latency"
          value={cohort.p95LatencyMs === null ? "—" : `${num(cohort.p95LatencyMs)} ms`}
        />
      </div>
      <Breakdown label="Grades" map={cohort.byGrade} />
      <Breakdown label="Families" map={cohort.byFamily} />
    </div>
  );
}

export function ResearchPanel() {
  const fetchLedger = useServerFn(getResearchLedger);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "research-ledger"],
    queryFn: () => fetchLedger(),
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) return <EmptyNote>Research ledger unavailable: {String(error)}</EmptyNote>;
  if (!data || data.cohorts.length === 0) {
    return (
      <EmptyNote>
        No evaluations recorded yet. Rows appear once the scanner completes cycles that fetched
        candles successfully.
      </EmptyNote>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <FlaskConical className="h-3.5 w-3.5" />
        <span>Last {data.windowHours}h.</span>
        <span className="font-mono">
          paired: {num(data.agreements)} agree / {num(data.disagreements)} disagree
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.cohorts.map((c) => (
          <Cohort key={c.modelVersion} cohort={c} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Model v2 never publishes and never changes alerts. It is evaluated on the same fetched
        candles as v1 so the two decision streams can be compared before any promotion.
      </p>
    </div>
  );
}
