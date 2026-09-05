/**
 * Broker-verified outcomes of the automatic trader (owner only).
 *
 * This panel reports only what the broker did: closed fills, broker-reported
 * money, and the grade each order carried. It is not the replay engine and not
 * user-reported. Zero closed trades renders a zero state — never a placeholder
 * number.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminAutoTraderOutcomes } from "@/lib/admin.functions";
import { PanelShell, num, pctOf } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";
import type { AutoTraderBucket } from "@/lib/admin/auto-trader-outcomes";

function money(bucket: AutoTraderBucket): string {
  if (bucket.mixedCurrency) return "mixed currencies";
  if (bucket.netProfit === null) return "—";
  return `${bucket.netProfit > 0 ? "+" : ""}${num(bucket.netProfit, 2)}${
    bucket.currency ? ` ${bucket.currency}` : ""
  }`;
}

function Row({ bucket, emphasis }: { bucket: AutoTraderBucket; emphasis?: boolean }) {
  return (
    <tr className={emphasis ? "border-b border-border font-semibold" : "border-b border-border/50"}>
      <td className="py-1 pr-2">
        {bucket.grade === "TOTAL" ? "All grades" : bucket.grade}
        {bucket.recoveredGrades > 0 ? (
          <span
            className="ml-1 text-muted-foreground"
            title={`${bucket.recoveredGrades} of these grades were proved from the enqueue decision log after the setup row was purged`}
          >
            *
          </span>
        ) : null}
      </td>
      <td className="py-1 pr-2 text-right">
        {bucket.trades}
        {bucket.unmeasured > 0 ? (
          <span
            className="ml-1 text-muted-foreground"
            title={`${bucket.unmeasured} closed trade(s) carry no broker-reported money, so they are excluded from win rate`}
          >
            ({bucket.measured}m)
          </span>
        ) : null}
      </td>
      <td className="py-1 pr-2 text-right">{pctOf(bucket.winRate)}</td>
      <td className="py-1 pr-2 text-right text-muted-foreground">
        {bucket.wins}/{bucket.losses}
        {bucket.scratches > 0 ? `/${bucket.scratches}` : ""}
      </td>
      <td className="py-1 pr-2 text-right">
        {bucket.meanR === null ? "—" : num(bucket.meanR)}
        {bucket.rSample > 0 && bucket.rSample < bucket.trades ? (
          <span className="ml-1 text-muted-foreground">(n={bucket.rSample})</span>
        ) : null}
      </td>
      <td className="py-1 text-right font-mono">{money(bucket)}</td>
    </tr>
  );
}

export function AutoTraderPanel() {
  const load = useServerFn(getAdminAutoTraderOutcomes);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-auto-trader-outcomes"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-32" />;

  return (
    <PanelShell
      title="Auto trader — broker-verified outcomes"
      right={
        <span className="text-[11px] text-muted-foreground">
          {data ? `${data.total.trades} closed broker trades` : "unavailable"}
        </span>
      }
    >
      {isError || !data ? (
        <p className="text-[11px] text-warning">
          The broker evidence ledger could not be read, so no claim is made here about auto-trader
          outcomes.
        </p>
      ) : data.total.trades === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No automatic order has closed at the broker yet. That says nothing about the scanner or
          the dispatcher — only that there is no closed fill to measure.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/60 text-left">
                  <th className="py-1 pr-2 font-medium">Grade</th>
                  <th className="py-1 pr-2 text-right font-medium">Trades</th>
                  <th className="py-1 pr-2 text-right font-medium">Win rate</th>
                  <th className="py-1 pr-2 text-right font-medium">W/L</th>
                  <th className="py-1 pr-2 text-right font-medium">Mean R vs plan</th>
                  <th className="py-1 text-right font-medium">Net (broker)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <Row bucket={data.total} emphasis />
                {data.byGrade.map((bucket) => (
                  <Row key={bucket.grade} bucket={bucket} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Win = broker net profit above zero (gross + swap + commission); an exactly flat trade is
            a scratch. Trades with no broker-reported money are shown in the trade count but
            excluded from win rate. * marks grades proved from the enqueue decision log after the
            setup row was purged — those trades have no plan geometry, so they carry no R.
          </p>
        </div>
      )}
    </PanelShell>
  );
}
