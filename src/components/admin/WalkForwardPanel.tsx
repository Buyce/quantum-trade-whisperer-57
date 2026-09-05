/**
 * Out-of-sample (walk-forward) confirmation per gate — owner only.
 *
 * Every figure comes from the hourly pass, which re-measures each gate on a
 * chronological split of the research population: earlier days train, later days
 * are held out. A gate without a fresh confirmation cannot have its threshold
 * proposed or applied automatically, and that state is shown as such — never as
 * a pass and never as a zero.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminWalkForward } from "@/lib/admin.functions";
import { PanelShell } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";

const r3 = (value: number | null): string => (value === null ? "—" : value.toFixed(3));

export function WalkForwardPanel() {
  const load = useServerFn(getAdminWalkForward);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-walk-forward"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-32" />;

  const rows = data ?? [];
  const confirmed = rows.filter((r) => r.confirmed).length;

  return (
    <PanelShell
      title="Out-of-sample confirmation (walk-forward)"
      right={
        <span className="text-[11px] text-muted-foreground">
          {rows.length === 0 ? "nothing measured yet" : `${confirmed} of ${rows.length} confirmed`}
        </span>
      }
    >
      {isError ? (
        <p className="text-[11px] text-warning">
          The out-of-sample records could not be read, so no threshold change may be proposed on
          this evidence.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No gate has been measured on a later, unseen period yet. Until one is, no threshold change
          can be proposed or applied automatically — the absence of a result withholds change, it
          never permits it.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60 text-left">
                <th className="py-1 pr-2 font-medium">Gate</th>
                <th className="py-1 pr-2 text-right font-medium">Train days</th>
                <th className="py-1 pr-2 text-right font-medium">Train ΔR</th>
                <th className="py-1 pr-2 text-right font-medium">Holdout days</th>
                <th className="py-1 pr-2 text-right font-medium">Holdout ΔR</th>
                <th className="py-1 pr-2 text-right font-medium">Holdout 95%</th>
                <th className="py-1 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.gate} className="border-b border-border/40 last:border-0">
                  <td className="py-1 pr-2 font-mono">{row.gate}</td>
                  <td className="num py-1 pr-2 text-right">{row.trainDays}</td>
                  <td className="num py-1 pr-2 text-right">{r3(row.trainDeltaR)}</td>
                  <td className="num py-1 pr-2 text-right">{row.holdoutDays}</td>
                  <td className="num py-1 pr-2 text-right">{r3(row.holdoutDeltaR)}</td>
                  <td className="num py-1 pr-2 text-right">
                    {row.holdoutLow === null || row.holdoutHigh === null
                      ? "—"
                      : `${r3(row.holdoutLow)} … ${r3(row.holdoutHigh)}`}
                  </td>
                  <td className="py-1 text-muted-foreground">
                    {row.confirmed ? (
                      <span className="text-success">confirmed out of sample</span>
                    ) : (
                      (row.blockers[0] ?? "not confirmed")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The split is chronological by trading day, so no later day influences the earlier
            period. A difference counts only when it keeps the same direction on the held-out days,
            is large enough to matter, and its interval excludes no-effect.
          </p>
        </div>
      )}
    </PanelShell>
  );
}
