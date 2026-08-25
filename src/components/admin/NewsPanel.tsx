/**
 * Live economic-event diagnostics (owner only).
 *
 * Deliberately shows coverage BEFORE events: the honest question is not "how many
 * events do we have" but "which (currency, family) scopes can we actually answer
 * for". A scope that is unsupported or unproven is rendered as such, and the panel
 * never rolls the scopes up into a single green light.
 *
 * Only the release DATE is shown when the provider publishes no exact time, with
 * the precision stated inline, so nobody can mistake a date for a release instant.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { PanelShell, timeAgo } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdminNews } from "@/lib/admin.functions";

function stateClass(state: string): string {
  if (state === "healthy") return "text-success";
  if (state === "timestamp_incomplete" || state === "partial") return "text-warning";
  return "text-muted-foreground";
}

function batchClass(status: string): string {
  if (status === "ok" || status === "empty") return "text-success";
  return "text-destructive";
}

export function NewsPanel() {
  const load = useServerFn(getAdminNews);
  const query = useQuery({
    queryKey: ["admin-news"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  if (query.isLoading) return <Skeleton className="h-40" />;

  if (query.isError || !query.data) {
    return (
      <PanelShell title="Economic events">
        <p className="text-[11px] text-warning">
          News diagnostics could not be read, so nothing is claimed here about event coverage.
        </p>
      </PanelShell>
    );
  }

  const { runs, provider_health, coverage, upcoming, evaluations } = query.data;

  return (
    <PanelShell title="Economic events">
      <div className="space-y-6">
        <p className="text-[11px] text-muted-foreground">
          Measured provider coverage, ingestion runs and dark policy comparisons. There is no
          aggregate "news healthy" flag, because no single flag would be truthful across scopes.
        </p>
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Provider health (from the run ledger)
          </h4>
          {provider_health.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No ingestion run has been attempted yet, so no provider is proven reachable.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[11px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left">Provider</th>
                    <th className="text-left">Last attempt</th>
                    <th className="text-left">Last success</th>
                    <th className="text-right">Runs 24h</th>
                    <th className="text-right">Failures 24h</th>
                  </tr>
                </thead>
                <tbody>
                  {provider_health.map((row) => (
                    <tr key={row.provider} className="border-t border-border/40">
                      <td className="py-1 font-medium">{row.provider}</td>
                      <td>{row.last_attempt_at ? timeAgo(row.last_attempt_at) : "—"}</td>
                      <td className={row.last_success_at ? "" : "text-destructive"}>
                        {row.last_success_at ? timeAgo(row.last_success_at) : "never"}
                      </td>
                      <td className="text-right">{row.runs_24h}</td>
                      <td className="text-right">{row.failures_24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Coverage by currency and event family
          </h4>
          {coverage.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No coverage has been measured yet. Until it is, every scope is unproven and news
              policy suppresses rather than clears.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[11px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left">Provider</th>
                    <th className="text-left">Currency</th>
                    <th className="text-left">Family</th>
                    <th className="text-left">State</th>
                    <th className="text-right">Events</th>
                    <th className="text-right">Exact time</th>
                    <th className="text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((row) => (
                    <tr
                      key={`${row.provider}-${row.currency}-${row.event_family}`}
                      className="border-t border-border/40"
                    >
                      <td className="py-1">{row.provider}</td>
                      <td>{row.currency ?? "—"}</td>
                      <td>{row.event_family}</td>
                      <td className={stateClass(row.coverage_state)}>{row.coverage_state}</td>
                      <td className="text-right">{row.scheduled_events}</td>
                      <td className="text-right">{row.events_with_exact_time}</td>
                      <td className="max-w-[260px] truncate text-muted-foreground">
                        {row.note ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Stored events (next 40 by schedule)
          </h4>
          {upcoming.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No events stored.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[11px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left">Event</th>
                    <th className="text-left">Family</th>
                    <th className="text-left">CCY</th>
                    <th className="text-left">Impact</th>
                    <th className="text-left">When</th>
                    <th className="text-left">Precision</th>
                    <th className="text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((event) => (
                    <tr key={event.canonical_event_id} className="border-t border-border/40">
                      <td className="py-1 font-medium">{event.canonical_event_id}</td>
                      <td>{event.event_family}</td>
                      <td>{event.currencies.join(", ") || "—"}</td>
                      <td>{event.importance}</td>
                      <td>{event.scheduled_at ?? event.scheduled_date ?? "—"}</td>
                      <td
                        className={
                          event.timestamp_precision === "exact" ? "text-success" : "text-warning"
                        }
                      >
                        {event.timestamp_precision}
                      </td>
                      <td>{event.event_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Latest ingestion runs
          </h4>
          {runs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No runs recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[11px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left">Started</th>
                    <th className="text-left">Provider</th>
                    <th className="text-left">Job</th>
                    <th className="text-left">Status</th>
                    <th className="text-right">Recv</th>
                    <th className="text-right">Ins</th>
                    <th className="text-right">Rev</th>
                    <th className="text-right">Dup</th>
                    <th className="text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={`${run.provider}-${run.started_at}`}
                      className="border-t border-border/40"
                    >
                      <td className="py-1">{timeAgo(run.started_at)}</td>
                      <td>{run.provider}</td>
                      <td>{run.job}</td>
                      <td className={batchClass(run.batch_status)}>{run.batch_status}</td>
                      <td className="text-right">{run.events_received}</td>
                      <td className="text-right">{run.inserts}</td>
                      <td className="text-right">{run.revisions}</td>
                      <td className="text-right">{run.duplicates}</td>
                      <td className="max-w-[220px] truncate text-muted-foreground">
                        {run.error_class ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Policy comparisons (dark unless stated enforcing)
          </h4>
          {evaluations.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No policy comparison has been recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[11px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left">When</th>
                    <th className="text-left">Instrument</th>
                    <th className="text-left">Boundary</th>
                    <th className="text-left">Mode</th>
                    <th className="text-left">Decision</th>
                    <th className="text-left">Coverage</th>
                    <th className="text-left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.map((row, index) => (
                    <tr
                      key={`${row.instrument}-${row.evaluated_at}-${index}`}
                      className="border-t border-border/40"
                    >
                      <td className="py-1">{timeAgo(row.evaluated_at)}</td>
                      <td className="font-medium">{row.instrument}</td>
                      <td>{row.boundary}</td>
                      <td>{row.mode}</td>
                      <td>{row.decision}</td>
                      <td className={stateClass(row.coverage_state)}>{row.coverage_state}</td>
                      <td className="max-w-[220px] truncate text-muted-foreground">
                        {row.reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PanelShell>
  );
}
