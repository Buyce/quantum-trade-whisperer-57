/**
 * Platform-wide win/loss totals (owner only).
 *
 * Broker-verified evidence is split by who placed the trade — the automatic trader,
 * trades P-Trades placed whose dispatch link was lost, and anything opened outside
 * P-Trades — and the in-app journal is kept as its own ledger, never merged with the
 * broker. Zero rows renders zeros — never a placeholder number.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminTradeTotals } from "@/lib/admin.functions";
import { PanelShell, num } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";
import type { BrokerTotals } from "@/lib/admin/trade-totals";

function Line({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div
      className={
        emphasis
          ? "flex items-baseline justify-between border-t border-border pt-1 font-semibold"
          : "flex items-baseline justify-between"
      }
    >
      <span className={emphasis ? "" : "text-muted-foreground"}>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function money(t: BrokerTotals): string {
  if (t.mixedCurrency) return "mixed currencies";
  if (t.grossProfit === null) return "—";
  return `${t.grossProfit > 0 ? "+" : ""}${num(t.grossProfit, 2)}${
    t.currency ? ` ${t.currency}` : ""
  }`;
}

function BrokerBlock({
  title,
  note,
  totals,
}: {
  title: string;
  note?: string;
  totals: BrokerTotals;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      <Line label="Wins" value={String(totals.wins)} />
      <Line label="Losses" value={String(totals.losses)} />
      <Line label="Breakeven" value={String(totals.breakeven)} />
      <Line label="Closed trades" value={String(totals.closed)} emphasis />
      <Line label="Accounts with evidence" value={String(totals.accounts)} />
      <Line label="Total gross P/L" value={money(totals)} emphasis />
      {totals.unmeasured > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          {totals.unmeasured} closed trade(s) carry no broker-reported money, so they are counted in
          the closed total but in no win/loss bucket.
        </p>
      ) : null}
      {note ? <p className="text-[10px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function TradeTotalsPanel() {
  const load = useServerFn(getAdminTradeTotals);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-trade-totals"],
    queryFn: () => load(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 45_000,
  });

  if (isLoading) return <Skeleton className="h-32" />;

  return (
    <PanelShell
      title="Platform totals — all connected accounts"
      defaultOpen
      right={
        <span className="text-[11px] text-muted-foreground">
          {data ? `${data.broker.all.closed} closed broker trades` : "unavailable"}
        </span>
      }
    >
      {isError || !data ? (
        <p className="text-[11px] text-warning">
          The ledgers could not be read, so no total is claimed here.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
            <BrokerBlock title="Automatic trader (broker-verified)" totals={data.broker.auto} />
            {data.broker.unlinked.closed > 0 ? (
              <BrokerBlock
                title="Unlinked broker trades (broker-verified)"
                note="Placed by P-Trades, but the dispatch record was purged, so they are claimed neither as automatic-trader nor as user results."
                totals={data.broker.unlinked}
              />
            ) : null}
            {data.broker.external.closed > 0 ? (
              <BrokerBlock
                title="Placed outside P-Trades (broker-verified)"
                note="No P-Trades order tag: opened directly at the broker."
                totals={data.broker.external}
              />
            ) : null}
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                In-app trade journal (user-recorded)
              </p>
              <Line label="Wins" value={String(data.journal.wins)} />
              <Line label="Losses" value={String(data.journal.losses)} />
              <Line label="Breakeven" value={String(data.journal.breakeven)} />
              <Line label="Open" value={String(data.journal.open)} />
              <Line label="Total journal rows" value={String(data.journal.rows)} emphasis />
              {data.journal.other > 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  {data.journal.other} row(s) carry no recognised outcome and are counted only in
                  the row total.
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-1 border-t border-border pt-2 text-[11px]">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              All broker-verified (every source combined)
            </p>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <Line label="Wins" value={String(data.broker.all.wins)} />
              <Line label="Losses" value={String(data.broker.all.losses)} />
              <Line label="Breakeven" value={String(data.broker.all.breakeven)} />
              <Line label="Accounts with evidence" value={String(data.broker.all.accounts)} />
              <Line label="Closed trades" value={String(data.broker.all.closed)} emphasis />
              <Line label="Total gross P/L" value={money(data.broker.all)} emphasis />
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Broker blocks are what the broker itself reported: win = net money above zero (gross +
            swap + commission), an exactly flat trade is breakeven. The journal is the in-app record
            people keep themselves and lags the broker while trades are still open, so it is not
            expected to match. Everything here covers every user and every connected account, and
            refreshes every minute.
          </p>
        </div>
      )}
    </PanelShell>
  );
}
