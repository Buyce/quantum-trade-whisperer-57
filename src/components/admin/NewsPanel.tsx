/**
 * Economic events (owner only).
 *
 * Shows exactly what the calendar layer holds and nothing more: which providers
 * ran, what coverage each scope is in, how many stored events carry an exact
 * release time, and what the gate decided at the execution boundaries.
 *
 * Two things this panel must never do: call an empty calendar "clear", and imply
 * news can refuse an order. Enforcement is pinned off, and the panel says so.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminNews } from "@/lib/admin.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelShell } from "@/components/admin/AdminPanels";

function when(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export function NewsPanel() {
  const load = useServerFn(getAdminNews);
  const query = useQuery({
    queryKey: ["admin-news"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (query.isLoading) return <Skeleton className="h-40" />;

  if (query.isError || !query.data) {
    return (
      <PanelShell title="Economic events">
        <p className="text-[11px] text-warning">
          The calendar records could not be read, so nothing is claimed here about news coverage.
          This is not the same as a clear calendar.
        </p>
      </PanelShell>
    );
  }

  const data = query.data;
  const exactTimeEvents = data.event_totals.reduce((sum, t) => sum + (t.exact_time_events ?? 0), 0);
  const storedEvents = data.event_totals.reduce((sum, t) => sum + (t.events ?? 0), 0);

  return (
    <PanelShell title="Economic events — coverage and verdicts">
      <p className="text-[11px] text-muted-foreground">
        News never refuses an automatic order. No calendar provider with exact release times is
        connected, so every verdict below is recorded for measurement only. FRED was retired as a
        calendar source: it publishes release dates without a release time.
      </p>

      <p className="mt-2 text-[11px]">
        {storedEvents} stored event(s), {exactTimeEvents} with an exact release time.{" "}
        {exactTimeEvents === 0 && (
          <span className="text-warning">
            With no exact times, an intraday news window cannot be established at all.
          </span>
        )}
      </p>

      <h4 className="mt-3 text-[11px] font-medium">Ingestion runs</h4>
      {data.runs.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No ingestion run recorded. Nothing was fetched and no coverage was claimed.
        </p>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[420px] text-[11px]">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal">provider</th>
                <th className="text-left font-normal">started</th>
                <th className="text-left font-normal">status</th>
                <th className="text-right font-normal">events</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.slice(0, 8).map((run) => (
                <tr key={`${run.provider}-${run.started_at}`} className="border-t border-border">
                  <td className="font-mono">{run.provider}</td>
                  <td>{when(run.started_at)}</td>
                  <td
                    className={
                      run.batch_status === "ok" || run.batch_status === "empty"
                        ? ""
                        : "text-warning"
                    }
                  >
                    {run.batch_status}
                    {run.error_class ? ` (${run.error_class})` : ""}
                  </td>
                  <td className="text-right">{run.events_received}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="mt-3 text-[11px] font-medium">Coverage by scope</h4>
      {data.coverage.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No coverage snapshot recorded. Coverage is unproven, not healthy.
        </p>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[420px] text-[11px]">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal">scope</th>
                <th className="text-left font-normal">state</th>
                <th className="text-right font-normal">exact-time</th>
                <th className="text-left font-normal">note</th>
              </tr>
            </thead>
            <tbody>
              {data.coverage.slice(0, 20).map((row) => (
                <tr
                  key={`${row.provider}-${row.currency}-${row.event_family}`}
                  className="border-t border-border"
                >
                  <td className="font-mono">
                    {row.currency ?? "—"} · {row.event_family}
                  </td>
                  <td className={row.coverage_state === "healthy" ? "" : "text-warning"}>
                    {row.coverage_state}
                  </td>
                  <td className="text-right">
                    {row.events_with_exact_time}/{row.scheduled_events}
                  </td>
                  <td className="text-muted-foreground">{row.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="mt-3 text-[11px] font-medium">Recorded verdicts</h4>
      {data.evaluation_summary.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No verdict recorded yet.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-[11px]">
          {data.evaluation_summary.slice(0, 12).map((row) => (
            <li key={`${row.instrument}-${row.mode}-${row.decision}`}>
              <span className="font-mono">{row.instrument}</span> — {row.decision} ({row.mode}) ×{" "}
              {row.n}
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
