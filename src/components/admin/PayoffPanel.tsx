/**
 * Expected-R research ledger (owner only).
 *
 * Read-only research. Nothing here feeds the live scanner, priors, or the
 * published feed. A cohort shows a mean only when the statistics are defined and
 * its mature plans are essentially fully resolved; otherwise it shows the exact
 * reason it is withheld.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Sigma } from "lucide-react";
import { toast } from "sonner";
import { getPayoffResearch, recomputePayoff } from "@/lib/payoff.functions";
import { formatR, isReportable, type PayoffCohort } from "@/lib/learning/payoff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyNote, num } from "./AdminPanels";

const ESTIMAND_LABEL: Record<string, string> = {
  mean_r_per_plan: "Mean R per published plan (non-trades = 0R)",
  mean_r_given_executable: "Mean R given the plan actually traded (conditional)",
};

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function CohortRow({ c }: { c: PayoffCohort }) {
  const reportable = isReportable(c);
  const coverage =
    c.replay_coverage === null ? "—" : `${(c.replay_coverage * 100).toFixed(1)}%`;
  const interval =
    reportable && c.ci_lo !== null && c.ci_hi !== null
      ? `${formatR(c.ci_lo)} … ${formatR(c.ci_hi)}`
      : "—";

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          {c.regime_key}
          <span className="ml-2 text-xs font-normal text-muted-foreground">tier {c.tier}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="font-mono text-[10px]">
            replay v{c.replay_version} · {c.execution_policy}
          </Badge>
          <Badge variant={reportable ? "secondary" : "outline"} className="text-[10px]">
            {c.stat_status.replace(/_/g, " ")}
          </Badge>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">{ESTIMAND_LABEL[c.estimand] ?? c.estimand}</div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Mean R" value={reportable ? formatR(c.mean_r) : "withheld"} />
        <Cell label="95% interval" value={interval} />
        <Cell label="Observations" value={num(c.n_used)} />
        <Cell label="Replay coverage" value={coverage} />
        <Cell label="Mature plans" value={num(c.n_mature)} />
        <Cell label="Traded" value={num(c.n_executable)} />
        <Cell label="Never filled (0R)" value={num(c.n_never_filled)} />
        <Cell label="Gap, no trade (0R)" value={num(c.n_gap_no_trade)} />
      </div>

      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <Badge variant="outline" className="font-mono text-[10px]">
          basis {c.payoff_basis}
        </Badge>
        <Badge variant="outline" className="font-mono text-[10px]">
          horizon {c.terminal_replay_horizon_hours}h
        </Badge>
        <Badge variant="outline" className="font-mono text-[10px]">
          excluded {num(c.n_invalid_excluded)}
        </Badge>
        {c.sd_r !== null ? (
          <Badge variant="outline" className="font-mono text-[10px]">
            sd {c.sd_r.toFixed(3)}R
          </Badge>
        ) : null}
      </div>

      {c.reason ? <div className="text-[11px] text-muted-foreground">{c.reason}</div> : null}
    </div>
  );
}

export function PayoffPanel() {
  const fetchPayoff = useServerFn(getPayoffResearch);
  const runRecompute = useServerFn(recomputePayoff);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "payoff-research"],
    queryFn: () => fetchPayoff(),
    staleTime: 60_000,
  });

  const recompute = useMutation({
    mutationFn: () => runRecompute({ data: {} }),
    onSuccess: () => {
      toast.success("Payoff cohorts rebuilt at a fresh snapshot instant");
      void qc.invalidateQueries({ queryKey: ["admin", "payoff-research"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) return <EmptyNote>Payoff research unavailable: {(error as Error).message}</EmptyNote>;

  const cohorts = data?.cohorts ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-[11px] text-muted-foreground">
          <Sigma className="mr-1 inline h-3 w-3" />
          Expected R is a return, not a probability. The headline estimand counts every
          published plan — a plan that never traded contributes exactly 0R. Broken
          observations are excluded from all denominators rather than scored. Research
          only: none of this feeds signal ranking or the learning priors.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={recompute.isPending}
          onClick={() => recompute.mutate()}
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${recompute.isPending ? "animate-spin" : ""}`} />
          Rebuild cohorts
        </Button>
      </div>

      {cohorts.length === 0 ? (
        <EmptyNote>
          No payoff cohorts computed yet. Rebuild to snapshot the currently mature plans.
        </EmptyNote>
      ) : (
        <div className="space-y-2">
          {cohorts.map((c) => (
            <CohortRow
              key={`${c.model_version}-${c.replay_version}-${c.execution_policy}-${c.estimand}-${c.tier}-${c.regime_key}`}
              c={c}
            />
          ))}
        </div>
      )}

      {data?.registry?.length ? (
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">Replay identities</span>
          {data.registry.map((r) => (
            <Badge key={r.version} variant="outline" className="font-mono text-[10px]">
              v{r.version} {r.label} · {r.code_hash}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
