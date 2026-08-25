/**
 * Instrument lifecycle and telemetry diagnostics (owner only).
 *
 * Reports four separate operational facts and never blends them into one verdict:
 *   1. the lifecycle stage each instrument is actually at;
 *   2. the most recent sampler runs, including what they refused and why;
 *   3. measured spread statistics with their coverage and missingness;
 *   4. the telemetry control room — which workers are on and what they may spend.
 *
 * A missing measurement is shown as "—", never as zero. Zero spread samples means
 * "nothing measured yet", which is not the same as "spreads are fine".
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminInstrumentDiagnostics, getAdminTelemetryControls } from "@/lib/admin.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelShell, timeAgo } from "@/components/admin/AdminPanels";

function n(value: unknown, digits = 5): string {
  const num = Number(value);
  return Number.isFinite(num) ? num.toPrecision(digits) : "—";
}

function pct(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? `${(num * 100).toFixed(0)}%` : "—";
}

export function InstrumentDiagnosticsPanel() {
  const loadDiagnostics = useServerFn(getAdminInstrumentDiagnostics);
  const loadControls = useServerFn(getAdminTelemetryControls);

  const diagnostics = useQuery({
    queryKey: ["admin-instrument-diagnostics"],
    queryFn: () => loadDiagnostics(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const controls = useQuery({
    queryKey: ["admin-telemetry-controls"],
    queryFn: () => loadControls(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  if (diagnostics.isLoading) return <Skeleton className="h-40" />;

  if (diagnostics.isError || !diagnostics.data) {
    return (
      <PanelShell title="Instrument lifecycle and telemetry">
        <p className="text-[11px] text-warning">
          Diagnostics could not be read, so nothing is claimed here about sampling or lifecycle
          state.
        </p>
      </PanelShell>
    );
  }

  const { lifecycle, sampler, spread_stats, latest_readiness } = diagnostics.data;
  const c = controls.data ?? null;

  return (
    <PanelShell
      title="Instrument lifecycle and telemetry"
      right={
        <span className="text-[11px] text-muted-foreground">
          {c
            ? `sampler ${c.sampler_enabled ? "on" : "off"} · ${c.sampler_symbols.length} symbol(s) · ≤${c.max_requests_per_run} req/run`
            : "controls unreadable"}
        </span>
      }
    >
      <div className="space-y-4">
        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Lifecycle stage
          </h4>
          {lifecycle.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No lifecycle rows.</p>
          ) : (
            <ul className="grid gap-1 sm:grid-cols-2">
              {lifecycle.map((row) => (
                <li key={String(row["symbol"])} className="flex items-baseline gap-2 text-[11px]">
                  <span className="w-20 font-mono text-foreground">{String(row["symbol"])}</span>
                  <span className="text-muted-foreground">{String(row["stage"])}</span>
                  {row["data_health"] ? (
                    <span className="truncate text-muted-foreground/70">
                      {String(row["data_health"])}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recent sampler runs
          </h4>
          {sampler.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No sampler run recorded yet. Nothing has been measured, which is not evidence that
              spreads are acceptable.
            </p>
          ) : (
            <ul className="space-y-1">
              {sampler.slice(0, 8).map((run) => (
                <li key={String(run["run_id"])} className="flex flex-wrap gap-x-2 text-[11px]">
                  <span className="w-16 shrink-0 text-muted-foreground">
                    {timeAgo(String(run["scheduled_at"]))}
                  </span>
                  <span className="text-foreground">
                    {(run["succeeded_instruments"] as unknown as string[] | null)?.length ?? 0}/
                    {(run["expected_instruments"] as unknown as string[] | null)?.length ?? 0} measured
                  </span>
                  <span className="text-muted-foreground">
                    {Number(run["request_count"] ?? 0)} req
                  </span>
                  {Number(run["invalid_samples"] ?? 0) > 0 ? (
                    <span className="text-warning">
                      {Number(run["invalid_samples"])} classified invalid
                    </span>
                  ) : null}
                  {Number(run["failed_requests"] ?? 0) > 0 ? (
                    <span className="text-destructive">
                      {Number(run["failed_requests"])} failed
                    </span>
                  ) : null}
                  {(run["stage_skipped"] as unknown as string[] | null)?.length ? (
                    <span className="text-muted-foreground/70">
                      stage-skipped {(run["stage_skipped"] as unknown as string[]).join(", ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Measured spread by session
          </h4>
          {spread_stats.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No spread statistics computed yet. A spread floor may not be derived from an empty
              sample.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-normal">Instrument</th>
                    <th className="text-left font-normal">Session</th>
                    <th className="text-right font-normal">n</th>
                    <th className="text-right font-normal">p50</th>
                    <th className="text-right font-normal">p90</th>
                    <th className="text-right font-normal">p90/ATR</th>
                    <th className="text-right font-normal">missing</th>
                  </tr>
                </thead>
                <tbody>
                  {spread_stats.slice(0, 24).map((row, i) => (
                    <tr key={`${String(row["instrument"])}-${String(row["session"])}-${i}`}>
                      <td className="font-mono text-foreground">{String(row["instrument"])}</td>
                      <td className="text-muted-foreground">{String(row["session"])}</td>
                      <td className="text-right">{Number(row["valid_samples"] ?? 0)}</td>
                      <td className="text-right">{n(row["p50_spread_price"])}</td>
                      <td className="text-right">{n(row["p90_spread_price"])}</td>
                      <td className="text-right">{n(row["p90_atr_fraction"], 3)}</td>
                      <td className="text-right">{pct(row["missingness"])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Latest readiness
          </h4>
          {latest_readiness.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No readiness snapshot recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {latest_readiness.map((row) => (
                <li key={String(row["instrument"])} className="flex flex-wrap gap-x-2 text-[11px]">
                  <span className="w-20 font-mono text-foreground">{String(row["instrument"])}</span>
                  <span className={row["ready"] === true ? "text-success" : "text-warning"}>
                    {row["ready"] === true ? "ready" : "not ready"}
                  </span>
                  <span className="text-muted-foreground">
                    conversion:{" "}
                    {row["execution_conversion_ready"] === true
                      ? "proven live"
                      : row["conversion_route_ready"] === true
                        ? "route only"
                        : "unproven"}
                  </span>
                  <span className="text-muted-foreground/70">
                    {timeAgo(String(row["checked_at"]))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PanelShell>
  );
}
