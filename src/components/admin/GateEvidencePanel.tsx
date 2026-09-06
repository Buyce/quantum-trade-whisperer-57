/**
 * Is the intelligence gate helping? (owner only)
 *
 * Each row is one instrument/direction cohort, with three readings that are
 * never blended: the replay win-if-filled rate, the replay expected R per
 * published plan with its measured range, and what the broker actually paid on
 * closed evidence. The verdict column shows what the owner's CURRENT thresholds
 * would do to that cohort, so a gate that refuses profitable cohorts — or admits
 * losing ones — is visible instead of assumed.
 *
 * Unmeasured stays unmeasured: an em dash, never a zero.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminGateEvidence } from "@/lib/admin.functions";
import { PanelShell, num } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";
import { GATE_VERDICT_COPY, type GateEvidenceRow } from "@/lib/admin/gate-evidence";

function verdictClass(v: GateEvidenceRow["verdict"]): string {
  if (v === "allowed") return "text-success";
  if (v === "gate_off") return "text-muted-foreground";
  return "text-warning";
}

function money(row: GateEvidenceRow): string {
  if (row.brokerMixedCurrency) return "mixed currencies";
  if (row.brokerNet === null) return "—";
  return `${row.brokerNet > 0 ? "+" : ""}${num(row.brokerNet, 2)}${
    row.brokerCurrency ? ` ${row.brokerCurrency}` : ""
  }`;
}

export function GateEvidencePanel() {
  const load = useServerFn(getAdminGateEvidence);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-gate-evidence"],
    queryFn: () => load(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 45_000,
  });

  if (isLoading) return <Skeleton className="h-32" />;

  const t = data?.thresholds;

  return (
    <PanelShell
      title="Intelligence gate — replay measurement vs broker outcome"
      right={
        <span className="text-[11px] text-muted-foreground">
          {t
            ? t.enabled
              ? `expected R floor ${t.minExpectedR ?? "not set"} · win rate ${
                  t.minWinPct ?? "not set"
                }% on ${t.minSample}+ samples`
              : "gate off"
            : "unavailable"}
        </span>
      }
    >
      {isError || !data ? (
        <p className="text-[11px] text-warning">
          The gate evidence could not be read, so no verdict is claimed here.
        </p>
      ) : data.rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No cohort has a reportable measurement or a closed broker trade yet, so there is nothing
          to compare.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3">Cohort</th>
                  <th className="py-1 pr-3">Expected R / plan</th>
                  <th className="py-1 pr-3">Range</th>
                  <th className="py-1 pr-3">Plans</th>
                  <th className="py-1 pr-3">Win if filled</th>
                  <th className="py-1 pr-3">Filled</th>
                  <th className="py-1 pr-3">Broker W/L</th>
                  <th className="py-1 pr-3">Broker net</th>
                  <th className="py-1">Gate verdict</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.rows.map((row) => (
                  <tr key={`${row.instrument}-${row.direction}`} className="border-t border-border">
                    <td className="py-1 pr-3">
                      {row.instrument} {row.direction}
                    </td>
                    <td className="py-1 pr-3">
                      {row.expectedR === null ? "—" : `${num(row.expectedR, 3)}R`}
                    </td>
                    <td className="py-1 pr-3">
                      {row.ciLo === null || row.ciHi === null
                        ? "—"
                        : `${num(row.ciLo, 3)} to ${num(row.ciHi, 3)}`}
                    </td>
                    <td className="py-1 pr-3">{row.expectedRN ?? "—"}</td>
                    <td className="py-1 pr-3">
                      {row.winPct === null ? "—" : `${num(row.winPct, 1)}%`}
                    </td>
                    <td className="py-1 pr-3">{row.filledN ?? "—"}</td>
                    <td className="py-1 pr-3">
                      {row.brokerTrades === 0 ? "—" : `${row.brokerWins}/${row.brokerLosses}`}
                    </td>
                    <td className="py-1 pr-3">{money(row)}</td>
                    <td className={`py-1 font-sans ${verdictClass(row.verdict)}`}>
                      {GATE_VERDICT_COPY[row.verdict]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Replay figures are historical measurements from resolved replay outcomes, not
            forecasts. The broker columns are what the accounts were actually paid on closed
            evidence, and the two can disagree — a cohort can win often and still lose money, or
            win rarely and make it. A cohort with no reportable measurement is refused while the
            gate is on, never passed. Refreshes every minute.
          </p>
        </div>
      )}
    </PanelShell>
  );
}
