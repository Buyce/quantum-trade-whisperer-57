/**
 * What refusals COST the dispatch queue over the last 7 days (owner only).
 *
 * "Not sent — refused by P-Trades" is not free: every attempt is a broker API
 * call and a slot in a bounded worker pass. This panel reports the recorded cost
 * per refusal reason so the expensive ones can be moved earlier (refused at
 * enqueue time) or slowed down (backoff), instead of being guessed at. It states
 * nothing about reasons that have not been recorded.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminRefusalCost } from "@/lib/admin.functions";
import { PanelShell } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";

export function RefusalCostPanel() {
  const load = useServerFn(getAdminRefusalCost);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-refusal-cost"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-32" />;

  const rows = data ?? [];
  const attempts = rows.reduce((sum, row) => sum + row.attempts, 0);

  return (
    <PanelShell
      title="Refusal cost (7 days)"
      right={
        <span className="text-[11px] text-muted-foreground">
          {rows.length === 0 ? "nothing settled" : `${attempts} attempts spent`}
        </span>
      }
    >
      {isError ? (
        <p className="text-[11px] text-warning">
          The delivery ledger could not be read, so no claim is made here about refusal cost.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No automatic order has been settled as refused, failed or expired in the last 7 days. That
          is not evidence that the dispatcher ran.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60 text-left">
                <th className="py-1 pr-2 font-medium">Reason</th>
                <th className="py-1 pr-2 text-right font-medium">Orders</th>
                <th className="py-1 pr-2 text-right font-medium">Attempts</th>
                <th className="py-1 pr-2 text-right font-medium">Worst</th>
                <th className="py-1 text-right font-medium">Median wait</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.reason} className="border-b border-border/40 last:border-0">
                  <td className="py-1 pr-2 font-mono">{row.reason}</td>
                  <td className="num py-1 pr-2 text-right">{row.rows}</td>
                  <td className="num py-1 pr-2 text-right">{row.attempts}</td>
                  <td className="num py-1 pr-2 text-right">{row.maxAttempts}</td>
                  <td className="num py-1 text-right">
                    {row.medianQueueMinutes === null ? "—" : `${row.medianQueueMinutes} min`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Attempts are broker calls actually spent on these orders. &ldquo;Worst&rdquo; is the
            highest attempt count a single order reached. Median wait is the time from queueing to
            settlement, so one long-parked order does not distort it.
          </p>
        </div>
      )}
    </PanelShell>
  );
}
