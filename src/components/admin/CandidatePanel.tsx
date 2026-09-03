/**
 * Research candidate funnel (owner-only).
 *
 * Answers one question the old learning engine could not: of everything the
 * scanner evaluated, what stopped each setup, and how much of that population is
 * being captured for research. Numbers are counts of rows actually captured —
 * capture disabled shows zero, never a simulation.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCandidateFunnel } from "@/lib/candidates.functions";
import { STAGE_LABELS } from "@/lib/learning/candidates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { describeResearchError, formatErrorAge } from "@/components/admin/research-error";

const ORIGIN_LABELS: Record<string, string> = {
  production: "Published plan (as traded)",
  counterfactual: "Research-only plan (filter-rejected)",
  none: "No plan derivable",
};

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg tabular-nums">{value}</div>
    </div>
  );
}

export function CandidatePanel() {
  const fetchFunnel = useServerFn(getCandidateFunnel);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "candidate-funnel"],
    queryFn: () => fetchFunnel(),
    refetchInterval: 120_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Research candidate funnel</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading capture state…</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Research candidate funnel</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Unavailable"}
        </CardContent>
      </Card>
    );
  }

  const flags = data?.flags ?? null;
  const totals = data?.totals ?? null;
  const captureOn = Boolean(flags?.candidate_capture_enabled);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Research candidate funnel</CardTitle>
            <CardDescription>
              Every setup the scanner evaluated, labelled with the gate that ended it. Research rows
              are isolated from trader-visible learning.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant={captureOn ? "default" : "outline"}>
              Capture {captureOn ? "on" : "off"}
            </Badge>
            <Badge variant={flags?.candidate_enrolment_enabled ? "default" : "outline"}>
              Enrolment {flags?.candidate_enrolment_enabled ? "on" : "off"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!captureOn ? (
          <p className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            Capture is dark. The scanner evaluates and labels every setup, but no candidate rows are
            written until the database switch is enabled. Published signals and learning are
            unaffected either way.
          </p>
        ) : (totals?.n ?? 0) === 0 ? (
          <p className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            Capture is live and nothing has been captured yet. Rows appear from the next scan cycle
            that reaches a graded evaluation; zero here means no evaluation has been recorded since
            capture was enabled, not that capture is off.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Captured" value={totals?.n ?? 0} />
          <Metric label="Last 24h" value={totals?.n_24h ?? 0} />
          <Metric label="Published" value={totals?.published ?? 0} />
          <Metric label="With geometry" value={totals?.with_geometry ?? 0} />
          <Metric label="Enrolled" value={totals?.enrolled ?? 0} />
          <Metric label="Enrolment backlog" value={totals?.enrolment_backlog ?? 0} />
          <Metric label="Incomplete gate lists" value={totals?.gates_incomplete ?? 0} />
          <Metric
            label="Last capture"
            value={
              totals?.last_seen ? new Date(totals.last_seen).toISOString().slice(0, 16) + "Z" : "—"
            }
          />
        </div>

        {/*
          Enrolment history over the FULL backlog, not the last 24h: this is the
          only place that shows whether the backfill actually reached the oldest
          captured setups, so every timestamp is a stored value, never inferred.
        */}
        <section className="rounded-lg border border-border p-3">
          <h4 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Enrolment history (all time)
          </h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Enrolable backlog" value={totals?.enrolable_backlog ?? 0} />
            <Metric label="Oldest waiting" value={utcShort(totals?.oldest_unenrolled_at ?? null)} />
            <Metric label="First enrolment" value={utcShort(totals?.first_enrolled_at ?? null)} />
            <Metric label="Last enrolment" value={utcShort(totals?.last_enrolled_at ?? null)} />
            <Metric
              label="Oldest enrolled setup"
              value={utcShort(totals?.oldest_enrolled_detected_at ?? null)}
            />
            <Metric label="Outside replay window" value={data?.outside_replay_window ?? 0} />
          </div>
          {data && data.enrolled_by_day?.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-1.5 text-left font-medium">Enrolled on (UTC)</th>
                    <th className="py-1.5 text-right font-medium">Candidates</th>
                    <th className="py-1.5 text-right font-medium">Oldest detection in batch</th>
                  </tr>
                </thead>
                <tbody>
                  {data.enrolled_by_day.map((row) => (
                    <tr key={row.day} className="border-b border-border/50">
                      <td className="py-1.5">{row.day.slice(0, 10)}</td>
                      <td className="py-1.5 text-right tabular-nums">{row.n}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {utcShort(row.oldest_detected_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              No candidate has been enrolled yet. Rows appear after the next hourly research run.
            </p>
          )}
        </section>



        <section>
          <h4 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Plan origin
          </h4>
          {data && data.by_plan_origin?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Origin</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Count</th>
                    <th className="py-1.5 text-right font-medium">Enrolled</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {data.by_plan_origin.map((row) => (
                    <tr key={row.plan_origin} className="border-t border-border/40">
                      <td className="py-1.5 pr-3 font-sans">
                        {ORIGIN_LABELS[row.plan_origin] ?? row.plan_origin}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{row.n}</td>
                      <td className="py-1.5 text-right">{row.enrolled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No candidates captured yet.</p>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Terminal stage
          </h4>
          {data && data.by_stage.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Stage</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Count</th>
                    <th className="py-1.5 text-right font-medium">With geometry</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {data.by_stage.map((row) => (
                    <tr key={row.terminal_stage} className="border-t border-border/40">
                      <td className="py-1.5 pr-3 font-sans">
                        {STAGE_LABELS[row.terminal_stage] ?? row.terminal_stage}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{row.n}</td>
                      <td className="py-1.5 text-right">{row.with_geometry}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No candidates captured yet.</p>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Gate outcomes
          </h4>
          {data && data.gate_outcomes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Gate</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Pass</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Fail</th>
                    <th className="py-1.5 text-right font-medium">Not evaluable</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {data.gate_outcomes.map((row) => (
                    <tr key={row.gate} className="border-t border-border/40">
                      <td className="py-1.5 pr-3 font-sans">{row.gate}</td>
                      <td className="py-1.5 pr-3 text-right">{row.pass}</td>
                      <td className="py-1.5 pr-3 text-right">{row.fail}</td>
                      <td className="py-1.5 text-right">{row.not_evaluable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Gate outcomes appear once capture is enabled and a scan cycle completes.
            </p>
          )}
        </section>

        <section className="text-xs text-muted-foreground">
          <span className="uppercase tracking-wider">Shadow cohorts</span>{" "}
          {Object.entries(data?.cohort_counts ?? {}).length > 0
            ? Object.entries(data!.cohort_counts)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")
            : "—"}
          {(() => {
            const err = describeResearchError(
              flags?.research_last_error,
              flags?.research_last_error_at,
            );
            if (!err) return null;
            // A latched error is not a live failure. A fresh one renders red;
            // one older than the staleness bound renders muted as history.
            return (
              <span
                className={
                  err.stale ? "mt-2 block text-muted-foreground" : "mt-2 block text-destructive"
                }
              >
                {err.stale ? "Last recorded research error" : "Last research error"}: {err.message}{" "}
                — {formatErrorAge(err.ageMs)} ago
                {err.stale ? " (no failures latched since)" : ""}
              </span>
            );
          })()}
        </section>
      </CardContent>
    </Card>
  );
}
