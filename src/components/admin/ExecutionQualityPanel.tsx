/**
 * Execution quality per account/instrument/session, and any automatic pause
 * currently in force (owner only).
 *
 * Every figure here is computed from closed broker trades and the delivery
 * ledger by the scheduled rollup. A dimension with too little recorded evidence
 * is shown as "not measured" — never as a zero — and a pause is only shown when
 * a cooldown row actually exists.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminExecutionQuality } from "@/lib/admin.functions";
import { PanelShell } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";

const num = (value: number | null, digits = 5): string =>
  value === null ? "—" : value.toFixed(digits);
const pct = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

export function ExecutionQualityPanel() {
  const load = useServerFn(getAdminExecutionQuality);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-execution-quality"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-32" />;

  const scores = data?.scores ?? [];
  const cooldowns = data?.cooldowns ?? [];
  const measured = scores.filter((s) => s.measured).length;

  return (
    <PanelShell
      title="Execution quality and automatic pauses"
      right={
        <span className="text-[11px] text-muted-foreground">
          {scores.length === 0 ? "nothing scored yet" : `${measured} of ${scores.length} measured`}
        </span>
      }
    >
      {isError ? (
        <p className="text-[11px] text-warning">
          The execution-quality tables could not be read, so no claim is made here about fill
          quality or pauses.
        </p>
      ) : (
        <>
          {cooldowns.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No account, instrument or session is paused by execution quality right now.
            </p>
          ) : (
            <ul className="mb-3 space-y-1">
              {cooldowns.map((c) => (
                <li key={`${c.accountId}|${c.instrument}|${c.session}`} className="text-[11px]">
                  <span className="font-mono text-warning">
                    {c.instrument} · {c.session}
                  </span>{" "}
                  paused until{" "}
                  {new Date(c.resumeAfter).toISOString().slice(0, 16).replace("T", " ")} UTC —{" "}
                  {c.detail ?? c.reason}
                </li>
              ))}
            </ul>
          )}

          {scores.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No dimension has been scored yet. That is not evidence of good execution — it means
              the recorded broker evidence has not yet been aggregated.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60 text-left">
                    <th className="py-1 pr-2 font-medium">Instrument · session</th>
                    <th className="py-1 pr-2 text-right font-medium">Closed</th>
                    <th className="py-1 pr-2 text-right font-medium">Median slip</th>
                    <th className="py-1 pr-2 text-right font-medium">Own norm</th>
                    <th className="py-1 pr-2 text-right font-medium">p90 slip</th>
                    <th className="py-1 pr-2 text-right font-medium">Avg R</th>
                    <th className="py-1 pr-2 text-right font-medium">Rejects</th>
                    <th className="py-1 pr-2 text-right font-medium">Margin</th>
                    <th className="py-1 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((s) => (
                    <tr
                      key={`${s.accountId}|${s.instrument}|${s.session}`}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="py-1 pr-2 font-mono">
                        {s.instrument} · {s.session}
                      </td>
                      <td className="num py-1 pr-2 text-right">{s.closedSample}</td>
                      <td className="num py-1 pr-2 text-right">{num(s.medianSlippage)}</td>
                      <td className="num py-1 pr-2 text-right">{num(s.normMedianSlippage)}</td>
                      <td className="num py-1 pr-2 text-right">{num(s.p90Slippage)}</td>
                      <td className="num py-1 pr-2 text-right">{num(s.avgR, 3)}</td>
                      <td className="num py-1 pr-2 text-right">{pct(s.rejectRate)}</td>
                      <td className="num py-1 pr-2 text-right">{s.marginRefusals}</td>
                      <td className="py-1 text-muted-foreground">
                        {s.measured ? "measured" : (s.unmeasuredReason ?? "not measured")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Slippage is in price units, exactly as the broker reported it, and each dimension is
                compared against its own earlier 60-day norm — never against another instrument. A
                pause only opens when the recent window is clearly worse than that same
                dimension&rsquo;s own history, and it lifts itself so the dimension is re-tested.
              </p>
            </div>
          )}
        </>
      )}
    </PanelShell>
  );
}
