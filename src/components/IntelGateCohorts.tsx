/**
 * READ-ONLY: the measured expected return per pair and direction, next to the
 * floor the owner set on the intelligence gate.
 *
 * Why this exists: the gate refuses on the PAIR AND DIRECTION history, not on a
 * setup's grade, so an A- or B-Grade setup on a pair whose measured history is
 * weak is refused just like any other. This panel shows the exact stored
 * measurement each refusal came from. It displays only — it decides nothing,
 * estimates nothing, and an unmeasured pair is labelled as unmeasured rather
 * than filled in.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getIntelGateCohorts } from "@/lib/execution.functions";
import { INSTRUMENT_LABELS } from "@/lib/db-types";

function r(v: number | null): string {
  return v === null ? "not measured" : `${v >= 0 ? "+" : ""}${v.toFixed(4)}R`;
}

export function IntelGateCohorts() {
  const load = useServerFn(getIntelGateCohorts);
  const q = useQuery({
    queryKey: ["intel-gate-cohorts"],
    queryFn: () => load(),
    staleTime: 60_000,
  });

  if (q.isLoading) {
    return <p className="mt-2 text-xs text-muted-foreground">Reading your measured history…</p>;
  }
  if (q.isError) {
    return (
      <p className="mt-2 text-xs text-warning">
        The measured history could not be read, so nothing is claimed here about your gate.
      </p>
    );
  }

  const data = q.data;
  const floor = data?.floor ?? null;
  const cohorts = data?.cohorts ?? [];

  return (
    <div className="mt-3 rounded-sm border border-border/60 bg-background/40 p-3">
      <h4 className="label-xs">What your gate is measuring</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Your gate compares each pair and direction against your floor{" "}
        {floor === null ? "(no floor set)" : `of ${floor.toFixed(4)}R`}. It does not look at the
        setup's tier, so an A- or B-Grade setup on a pair below your floor is refused, while a
        C-Grade setup on a pair above it can pass. Every figure below is a measured replay average
        over whole published plans, including plans that never traded, counted as 0R.
        {data?.gateEnabled ? "" : " Your gate is currently switched off, so nothing here refuses an order."}
      </p>

      {cohorts.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No pair is selected on this account, so there is nothing to compare.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2 font-normal">Pair / direction</th>
                <th className="py-1 pr-2 font-normal">Measured expected return</th>
                <th className="py-1 pr-2 font-normal">Plans measured</th>
                <th className="py-1 font-normal">Against your floor</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={`${c.instrument}-${c.direction}`} className="border-t border-border/40">
                  <td className="py-1 pr-2 text-foreground">
                    {INSTRUMENT_LABELS[c.instrument] ?? c.instrument} {c.direction}
                  </td>
                  <td className="py-1 pr-2 tabular-nums">
                    {r(c.meanR)}
                    {c.ciLo !== null && c.ciHi !== null ? (
                      <span className="text-muted-foreground">
                        {" "}
                        (range {c.ciLo.toFixed(4)} to {c.ciHi.toFixed(4)})
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2 tabular-nums text-muted-foreground">
                    {c.samples === null ? "—" : c.samples}
                  </td>
                  <td className="py-1">
                    {c.passesFloor === null ? (
                      <span className="text-muted-foreground">not comparable yet</span>
                    ) : c.passesFloor ? (
                      <span className="text-success">passes</span>
                    ) : (
                      <span className="text-warning">below your floor</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        A pair below your floor is a record of what has been measured, not a forecast. Lowering or
        clearing your floor lets more setups through; it does not make them more likely to win.
        {data?.allowUnmeasured
          ? " You allow unmeasured pairs through, so a pair with no measurement can still be ordered."
          : " Unmeasured pairs are refused, because you have not allowed unmeasured pairs through."}
      </p>
    </div>
  );
}
