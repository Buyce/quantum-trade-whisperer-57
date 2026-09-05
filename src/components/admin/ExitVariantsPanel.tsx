/**
 * Exit-variant research — owner only, replay only.
 *
 * Every figure here is simulated over the recorded market path of a replayed
 * setup. No order was placed and no money moved. The executed policy remains a
 * single exit at the first target, and nothing on this panel changes it.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminExitVariants } from "@/lib/admin.functions";
import { PanelShell } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BASELINE_VARIANT,
  EXIT_VARIANT_LABELS,
  type ExitVariant,
} from "@/lib/execution/exit-variants";

const r3 = (value: number | null): string => (value === null ? "not measured" : value.toFixed(3));

const label = (variant: string): string => EXIT_VARIANT_LABELS[variant as ExitVariant] ?? variant;

export function ExitVariantsPanel() {
  const load = useServerFn(getAdminExitVariants);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-exit-variants"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-32" />;

  const rows = data ?? [];
  const winners = rows.filter((r) => r.holdoutConfirmed).length;

  return (
    <PanelShell
      title="Exit variants (replay research only)"
      right={
        <span className="text-[11px] text-muted-foreground">
          {rows.length === 0
            ? "nothing measured yet"
            : winners === 0
              ? "none beats the current policy"
              : `${winners} beats the current policy out of sample`}
        </span>
      }
    >
      {isError ? (
        <p className="text-[11px] text-warning">
          The replay comparison could not be read. The executed policy is unchanged.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No replayed market paths have been recorded and matured yet, so partial exits, runners,
          break-even moves and trailing stops are not measured. They are reported as unmeasured
          rather than estimated.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60 text-left">
                <th className="py-1 pr-2 font-medium">Exit rule</th>
                <th className="py-1 pr-2 text-right font-medium">Setups</th>
                <th className="py-1 pr-2 text-right font-medium">Not decidable</th>
                <th className="py-1 pr-2 text-right font-medium">Average R</th>
                <th className="py-1 pr-2 text-right font-medium">vs current</th>
                <th className="py-1 font-medium">Out-of-sample</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.variant} className="border-b border-border/40 last:border-0">
                  <td className="py-1 pr-2">
                    {label(row.variant)}
                    {row.variant === BASELINE_VARIANT ? (
                      <span className="ml-1 text-muted-foreground">(live)</span>
                    ) : null}
                  </td>
                  <td className="num py-1 pr-2 text-right">{row.samples}</td>
                  <td className="num py-1 pr-2 text-right">{row.undecidable}</td>
                  <td className="num py-1 pr-2 text-right">{r3(row.meanR)}</td>
                  <td className="num py-1 pr-2 text-right">
                    {row.variant === BASELINE_VARIANT ? "—" : r3(row.deltaR)}
                  </td>
                  <td className="py-1 text-muted-foreground">
                    {row.variant === BASELINE_VARIANT ? (
                      "baseline"
                    ) : row.holdoutConfirmed ? (
                      <span className="text-success">holds on later, unseen days</span>
                    ) : (
                      (row.blockers[0] ?? row.detail ?? "not confirmed")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Simulated over replayed candles, never executed. A setup counts only when the same
            recorded path decides both the current policy and the variant; where the order of events
            inside a candle cannot be established, the setup is left out rather than guessed. The
            executed policy stays a single exit at the first target until a variant wins out of
            sample and is promoted deliberately.
          </p>
        </div>
      )}
    </PanelShell>
  );
}
