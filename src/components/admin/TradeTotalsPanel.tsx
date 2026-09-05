/**
 * Platform-wide win/loss totals (owner only).
 *
 * Two ledgers side by side and never merged: closed broker-trade evidence across
 * every connected account, and the in-app trade journal. Zero rows renders zeros —
 * never a placeholder number.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminTradeTotals } from "@/lib/admin.functions";
import { PanelShell, num } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";

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
          {data ? `${data.broker.closed} closed broker trades` : "unavailable"}
        </span>
      }
    >
      {isError || !data ? (
        <p className="text-[11px] text-warning">
          The ledgers could not be read, so no total is claimed here.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-3 text-[11px] sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Broker-verified (source of truth)
              </p>
              <Line label="Wins" value={String(data.broker.wins)} />
              <Line label="Losses" value={String(data.broker.losses)} />
              <Line label="Breakeven" value={String(data.broker.breakeven)} />
              <Line label="Closed trades" value={String(data.broker.closed)} emphasis />
              <Line label="Accounts with evidence" value={String(data.broker.accounts)} />
              <Line
                label="Total gross P/L"
                value={
                  data.broker.mixedCurrency
                    ? "mixed currencies"
                    : data.broker.grossProfit === null
                      ? "—"
                      : `${data.broker.grossProfit > 0 ? "+" : ""}${num(data.broker.grossProfit, 2)}${
                          data.broker.currency ? ` ${data.broker.currency}` : ""
                        }`
                }
                emphasis
              />
              {data.broker.unmeasured > 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  {data.broker.unmeasured} closed trade(s) carry no broker-reported money, so they
                  are counted in the closed total but in no win/loss bucket.
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                In-app trade journal
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
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The broker block is what the broker itself reported: win = net money above zero (gross +
            swap + commission), an exactly flat trade is breakeven. The journal is the in-app record
            and lags the broker while trades are still open, so the two blocks are not expected to
            match. Both cover every user and every connected account, and refresh every minute.
          </p>
        </div>
      )}
    </PanelShell>
  );
}
