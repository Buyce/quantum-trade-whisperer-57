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
        {!captureOn && (
          <p className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            Capture is dark. The scanner evaluates and labels every setup, but no candidate rows are
            written until the database switch is enabled. Published signals and learning are
            unaffected either way.
          </p>
        )}

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
            value={totals?.last_seen ? new Date(totals.last_seen).toISOString().slice(0, 16) + "Z" : "—"}
          />
        </div>

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
          {flags?.research_last_error && (
            <span className="mt-2 block text-destructive">
              Last research error: {flags.research_last_error}
            </span>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
