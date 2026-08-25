/**
 * Commissioning status (owner only).
 *
 * One row per registry instrument showing exactly what has been PROVEN about it:
 * wave, lifecycle stage, provider symbol, mapping and specification status,
 * candle/quote quality, conversion readiness, calendar verification, sampler
 * coverage, valid and invalid sample counts, breaker state, scan duration,
 * provider errors, promotion blockers and the last successful readiness check.
 *
 * A missing measurement renders "—", never zero, and a blocker list is shown
 * verbatim rather than summarised into a verdict. No token, account id, login or
 * raw provider payload is ever rendered here.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminCommissioning } from "@/lib/admin.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelShell, timeAgo } from "@/components/admin/AdminPanels";

type Row = Record<string, unknown>;

function obj(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function txt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function ms(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? `${Math.round(num)}ms` : "—";
}

function checkSummary(readiness: Row): string {
  const checks = Array.isArray(readiness["checks"])
    ? (readiness["checks"] as { name?: string; ok?: boolean }[])
    : [];
  if (checks.length === 0) return "—";
  return checks.map((c) => `${c.name ?? "?"}${c.ok ? "✓" : "✗"}`).join(" ");
}

export function CommissioningPanel() {
  const load = useServerFn(getAdminCommissioning);
  const query = useQuery({
    queryKey: ["admin-commissioning"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  if (query.isLoading) return <Skeleton className="h-40" />;

  if (query.isError || !query.data) {
    return (
      <PanelShell title="Commissioning status">
        <p className="text-[11px] text-warning">
          Commissioning diagnostics could not be read, so nothing is claimed here about instrument
          readiness.
        </p>
      </PanelShell>
    );
  }

  const { instruments, lifecycle_enforced, sampler_symbols } = query.data;

  return (
    <PanelShell
      title="Commissioning status"
      right={
        <span className="text-[11px] text-muted-foreground">
          lifecycle enforcement {lifecycle_enforced ? "on" : "off"} · {sampler_symbols?.length ?? 0}{" "}
          sampled symbol(s)
        </span>
      }
    >
      {instruments.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No instrument rows.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="pr-3">Instrument</th>
                <th className="pr-3">Wave</th>
                <th className="pr-3">Stage</th>
                <th className="pr-3">Provider symbol</th>
                <th className="pr-3">Mapping</th>
                <th className="pr-3">Spec as of</th>
                <th className="pr-3">Readiness checks</th>
                <th className="pr-3">Conversion</th>
                <th className="pr-3">Calendar</th>
                <th className="pr-3">Sampled</th>
                <th className="pr-3">Samples 24h</th>
                <th className="pr-3">Breaker</th>
                <th className="pr-3">Scan 24h</th>
                <th className="pr-3">Last ready</th>
                <th>Blockers</th>
              </tr>
            </thead>
            <tbody>
              {instruments.map((raw) => {
                const row = obj(raw);
                const readiness = obj(row["readiness"]);
                const calendar = obj(row["calendar"]);
                const samples = obj(row["samples_24h"]);
                const breaker = obj(row["breaker"]);
                const scan = obj(row["scan_24h"]);
                const blockers = Array.isArray(row["blockers"])
                  ? (row["blockers"] as string[])
                  : [];
                const breakerOpen =
                  breaker["available"] === false || Boolean(breaker["breaker_open_until"]);
                return (
                  <tr key={String(row["symbol"])} className="border-t border-border/40">
                    <td className="py-1 pr-3 font-medium">{txt(row["symbol"])}</td>
                    <td className="pr-3">{txt(row["wave"])}</td>
                    <td className="pr-3">{txt(row["stage"])}</td>
                    <td className="pr-3">{txt(row["provider_symbol"])}</td>
                    <td className="pr-3">{txt(row["mapping_status"])}</td>
                    <td className="pr-3">
                      {row["spec_as_of"] ? timeAgo(String(row["spec_as_of"])) : "—"}
                    </td>
                    <td className="pr-3 whitespace-nowrap">{checkSummary(readiness)}</td>
                    <td className="pr-3">
                      {readiness["conversion_route_ready"] === undefined
                        ? "—"
                        : `${readiness["conversion_route_ready"] ? "route✓" : "route✗"} ${
                            readiness["conversion_data_ready"] ? "legs✓" : "legs✗"
                          }`}
                    </td>
                    <td className="pr-3">
                      {calendar["calendar_key"]
                        ? `${txt(calendar["calendar_key"])} v${txt(calendar["calendar_version"])} ${
                            calendar["verified"] ? "verified" : "unverified"
                          }`
                        : "unbound"}
                    </td>
                    <td className="pr-3">{row["sampled"] ? "yes" : "no"}</td>
                    <td className="pr-3">
                      {txt(samples["valid"])} valid / {txt(samples["invalid"])} invalid
                      {samples["last_quality"] ? ` · last ${txt(samples["last_quality"])}` : ""}
                    </td>
                    <td className="pr-3">{breakerOpen ? "open" : "closed"}</td>
                    <td className="pr-3">
                      {txt(scan["jobs"])} jobs · {ms(scan["avg_duration_ms"])} avg ·{" "}
                      {txt(scan["failed"])} failed
                    </td>
                    <td className="pr-3">
                      {row["last_ready_at"] ? timeAgo(String(row["last_ready_at"])) : "never"}
                    </td>
                    <td className="text-warning">
                      {blockers.length ? blockers.join(", ") : "none"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        A row at <code>data_validation</code> collects candles, quotes and spread samples only. It
        does not evaluate strategy, publish a signal, send an alert or reach a broker. An unverified
        calendar authorises raw collection only.
      </p>
    </PanelShell>
  );
}
