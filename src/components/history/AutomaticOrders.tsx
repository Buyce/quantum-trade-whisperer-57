/**
 * The "Automatic orders" view of Trade History.
 *
 * Shows every order P-Trades submitted on the user's behalf, with the broker's
 * own verdict. Nothing on this screen is editable and nothing is estimated:
 * prices, profit and R appear only once the reconciler matched real broker
 * deals to the order. An order awaiting confirmation is labelled as such, never
 * shown as a result.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Download, ShieldCheck } from "lucide-react";
import { brokerOrdersQuery, BROKER_ORDER_PAGE_SIZE } from "@/lib/queries";
import {
  brokerOrderPending,
  type BrokerOrderStatusKind,
  type BrokerOrderView,
} from "@/lib/history/broker-orders";
import { brokerOrdersToCsv, brokerOrdersToExportJson } from "@/lib/export";
import { downloadCsv, downloadJson, todayStamp } from "@/lib/export";
import { formatJournalR } from "@/lib/journal/display";
import { INSTRUMENT_LABELS } from "@/lib/db-types";
import { GradeBadge } from "@/components/SignalCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<BrokerOrderStatusKind, string> = {
  queued: "border-border bg-muted/40 text-muted-foreground",
  submitting: "border-border bg-muted/40 text-muted-foreground",
  awaiting_confirmation: "border-warning/40 bg-warning/10 text-warning",
  accepted: "border-primary/40 bg-primary/10 text-primary",
  open_at_broker: "border-warning/40 bg-warning/10 text-warning",
  closed_at_broker: "border-success/40 bg-success/10 text-success",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
  not_sent: "border-border bg-muted/40 text-muted-foreground",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  unknown: "border-warning/40 bg-warning/10 text-warning",
};

function num(v: number | null | undefined, digits = 5) {
  return v == null ? "—" : Number(v).toFixed(digits);
}

function when(v: string | null) {
  return v
    ? new Date(v).toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

export function AutomaticOrders({ userId }: { userId: string | undefined }) {
  const orders = useQuery(brokerOrdersQuery(userId));
  const rows = orders.data ?? [];
  const pendingCount = useMemo(() => rows.filter(brokerOrderPending).length, [rows]);

  if (orders.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (orders.isError) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
        Could not load your automatic orders. Try refreshing.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every order P-Trades submitted to your connected broker, with the broker's own record of
          what happened. These rows are broker-reported and cannot be edited. Because they are
          verified differently from trades you log yourself, Performance values them as a separate
          broker-evidence population.
        </p>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button
            size="sm"
            variant="ghost"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(`ptrades_automatic_orders_${todayStamp()}.csv`, brokerOrdersToCsv(rows))
            }
          >
            <Download className="size-4" /> Export visible rows (CSV)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={rows.length === 0}
            onClick={() =>
              downloadJson(
                `ptrades_automatic_orders_${todayStamp()}.json`,
                brokerOrdersToExportJson(rows),
              )
            }
          >
            <Download className="size-4" /> Export visible rows (JSON)
          </Button>
        </div>
      </div>

      {rows.length >= BROKER_ORDER_PAGE_SIZE ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-muted-foreground">
          This screen shows the newest {BROKER_ORDER_PAGE_SIZE} automatic orders. Older orders
          remain stored and are still valued by Performance, but are not in this view or its
          exports.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-4 py-10 text-center sm:px-6 sm:py-16">
          <p className="num text-lg font-semibold text-foreground">NO AUTOMATIC ORDERS YET</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            No order has been submitted for you in this view. Orders appear here once a connected
            account is armed for automatic execution and a qualifying setup is published.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {pendingCount} {pendingCount === 1 ? "order has" : "orders have"} no closed broker
              result yet, so no outcome is claimed for {pendingCount === 1 ? "it" : "them"}.
            </p>
          ) : null}
          {rows.map((row) => (
            <OrderCard key={row.key} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({ row }: { row: BrokerOrderView }) {
  const digits = row.instrument === "XAUUSD" ? 2 : 5;
  const long = row.direction === "long";
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="grid gap-2 border-b border-border px-3 py-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="num text-sm font-bold">{row.instrument}</span>
          <span className="truncate text-xs text-muted-foreground">
            {INSTRUMENT_LABELS[row.instrument] ?? ""}
          </span>
          {row.grade !== "Unknown" ? <GradeBadge grade={row.grade} /> : null}
          {row.direction ? (
            <span
              className={cn(
                "num inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs",
                long
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              {long ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {long ? "LONG" : "SHORT"}
            </span>
          ) : null}
          {row.dryRun ? (
            <span className="num rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              Dry run · not sent to a broker
            </span>
          ) : null}
          {row.accountType ? (
            <span className="num rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {row.accountType === "real" ? "Live account" : `${row.accountType} account`}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:shrink-0">
          <span
            className={cn(
              "num inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] uppercase",
              STATUS_STYLES[row.status.kind],
            )}
            title={row.status.detail ?? undefined}
          >
            {row.status.label}
          </span>
          {row.broker ? (
            <span
              className="num inline-flex items-center gap-1 rounded-sm border border-success/40 bg-success/10 px-1.5 py-0.5 text-[11px] text-success"
              title="Prices and profit are taken from the broker's own deal records, not self-reported."
            >
              <ShieldCheck className="size-3" /> Broker verified
            </span>
          ) : null}
          <span className="num text-xs text-muted-foreground">{when(row.enqueuedAt)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
        <Cell label="Submitted volume" value={num(row.submitted.volume, 2)} />
        <Cell label="Submitted entry" value={num(row.submitted.entry, digits)} />
        <Cell
          label="Submitted stop"
          value={num(row.submitted.stop, digits)}
          className="text-destructive"
        />
        <Cell
          label="Submitted target"
          value={num(row.submitted.target, digits)}
          className="text-success"
        />
        <Cell label="Broker fill" value={num(row.broker?.entryPrice, digits)} />
        <Cell label="Broker exit" value={num(row.broker?.exitPrice, digits)} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-xs sm:px-4">
        <span className="label-xs">Broker result</span>
        {row.broker ? (
          <>
            <span className="num text-foreground">
              {row.broker.state === "closed" ? "Closed" : "Open"} ·{" "}
              {row.broker.grossProfit == null
                ? "profit not reported"
                : `${Number(row.broker.grossProfit).toFixed(2)} ${row.broker.currency ?? ""}`.trim()}
            </span>
            <span className="num text-muted-foreground">
              {row.r.label}: {formatJournalR(row.r)}
            </span>
            {row.r.value === null && row.r.reason ? (
              <span className="text-warning">{row.r.reason}</span>
            ) : null}
            <span className="num text-muted-foreground">
              in {when(row.broker.entryAt)} → out {when(row.broker.exitAt)}
            </span>
          </>
        ) : (
          <span className="text-warning">
            {row.status.detail ?? "No broker deal has been matched to this order yet."}
          </span>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-card px-4 py-2.5">
      <p className="label-xs">{label}</p>
      <p className={cn("num text-sm font-semibold", className)}>{value}</p>
    </div>
  );
}
