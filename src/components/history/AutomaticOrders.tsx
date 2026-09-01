/**
 * The "Automatic orders" view of Trade History.
 *
 * Shows every order P-Trades submitted on the user's behalf, with the broker's
 * own verdict. Nothing on this screen is editable and nothing is estimated:
 * prices, profit, slippage and R appear only once the reconciler matched real
 * broker deals to the order. An order awaiting confirmation is labelled as such,
 * never shown as a result.
 *
 * The filter bar narrows the ROWS ALREADY LOADED. Its counts always name the
 * loaded set, so a filtered empty view can never imply anything about the
 * scanner, your broker, or trades outside this page.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Filter,
  LayoutList,
  ShieldCheck,
  Table as TableIcon,
  X,
} from "lucide-react";
import { brokerOrdersQuery, BROKER_ORDER_PAGE_SIZE } from "@/lib/queries";
import {
  brokerOrderPending,
  type BrokerOrderStatusKind,
  type BrokerOrderView,
} from "@/lib/history/broker-orders";
import {
  EMPTY_ORDER_FILTERS,
  filterBrokerOrders,
  gradesInRows,
  instrumentsInRows,
  netByCurrency,
  orderFiltersActive,
  type OrderFilterState,
  type OrderResultFilter,
} from "@/lib/history/order-filters";
import { slippageUnavailableCopy } from "@/lib/evidence/slippage";
import { brokerOrdersToCsv, brokerOrdersToExportJson } from "@/lib/export";
import { downloadCsv, downloadJson, todayStamp } from "@/lib/export";
import { formatJournalR } from "@/lib/journal/display";
import { INSTRUMENT_LABELS } from "@/lib/db-types";
import { GradeBadge } from "@/components/SignalCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const RESULT_OPTIONS: Array<{ value: OrderResultFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "winners", label: "Winners" },
  { value: "losers", label: "Losers" },
  { value: "breakeven", label: "Breakeven" },
  { value: "open", label: "Open" },
  { value: "not_filled", label: "Not filled" },
];

function num(v: number | null | undefined, digits = 5) {
  return v == null ? "—" : Number(v).toFixed(digits);
}

function money(v: number | null | undefined, currency: string | null | undefined) {
  if (v == null) return "—";
  return `${Number(v).toFixed(2)} ${currency ?? ""}`.trim();
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

function digitsFor(instrument: string) {
  return instrument === "XAUUSD" || instrument.startsWith("XAG") || instrument.includes("OIL")
    ? 2
    : 5;
}

/** Slippage cell text plus the exact reason it is unavailable. */
function slippageText(row: BrokerOrderView): { value: string; title: string | undefined } {
  const slip = row.broker?.slippage;
  if (!slip) return { value: "—", title: "No broker deal has been matched to this order yet." };
  if (slip.price === null) {
    return {
      value: "unavailable",
      title: slippageUnavailableCopy(slip.availability) ?? undefined,
    };
  }
  const digits = digitsFor(row.instrument);
  const signed = `${slip.price > 0 ? "+" : ""}${slip.price.toFixed(digits)}`;
  return {
    value: signed,
    title: `Broker fill versus the ${slip.basis === "published" ? "published" : "submitted"} entry price ${slip.reference?.toFixed(digits) ?? "—"}. Positive means the broker filled worse than that price.`,
  };
}

export function AutomaticOrders({ userId }: { userId: string | undefined }) {
  const orders = useQuery(brokerOrdersQuery(userId));
  const rows = orders.data ?? [];
  const [filters, setFilters] = useState<OrderFilterState>(EMPTY_ORDER_FILTERS);
  const [layout, setLayout] = useState<"cards" | "table">("cards");

  const visible = useMemo(() => filterBrokerOrders(rows, filters), [rows, filters]);
  const pendingCount = useMemo(() => visible.filter(brokerOrderPending).length, [visible]);
  const instruments = useMemo(() => instrumentsInRows(rows), [rows]);
  const grades = useMemo(() => gradesInRows(rows), [rows]);
  const money$ = useMemo(() => netByCurrency(visible), [visible]);
  const active = orderFiltersActive(filters);

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

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

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
            variant={layout === "cards" ? "secondary" : "ghost"}
            onClick={() => setLayout("cards")}
          >
            <LayoutList className="size-4" /> Cards
          </Button>
          <Button
            size="sm"
            variant={layout === "table" ? "secondary" : "ghost"}
            onClick={() => setLayout("table")}
          >
            <TableIcon className="size-4" /> Table
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={visible.length === 0}
            onClick={() =>
              downloadCsv(`ptrades_automatic_orders_${todayStamp()}.csv`, brokerOrdersToCsv(visible))
            }
          >
            <Download className="size-4" /> Export filtered (CSV)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={visible.length === 0}
            onClick={() =>
              downloadJson(
                `ptrades_automatic_orders_${todayStamp()}.json`,
                brokerOrdersToExportJson(visible),
              )
            }
          >
            <Download className="size-4" /> Export filtered (JSON)
          </Button>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="space-y-3 rounded-md border border-border bg-card px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-xs inline-flex items-center gap-1">
              <Filter className="size-3" /> Filters
            </span>
            <span className="num text-xs text-muted-foreground">
              {visible.length} of {rows.length} loaded {rows.length === 1 ? "order" : "orders"} shown
            </span>
            {active ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setFilters(EMPTY_ORDER_FILTERS)}
              >
                <X className="size-3" /> Clear filters
              </Button>
            ) : null}
          </div>

          <FilterRow label="Instrument">
            {instruments.map((instrument) => (
              <Chip
                key={instrument}
                active={filters.instruments.includes(instrument)}
                onClick={() =>
                  setFilters((f) => ({ ...f, instruments: toggle(f.instruments, instrument) }))
                }
              >
                {instrument}
              </Chip>
            ))}
          </FilterRow>

          <FilterRow label="Grade">
            {grades.map((grade) => (
              <Chip
                key={grade}
                active={filters.grades.includes(grade)}
                onClick={() => setFilters((f) => ({ ...f, grades: toggle(f.grades, grade) }))}
              >
                {grade}
              </Chip>
            ))}
          </FilterRow>

          <FilterRow label="Result">
            {RESULT_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                active={filters.result === option.value}
                onClick={() => setFilters((f) => ({ ...f, result: option.value }))}
              >
                {option.label}
              </Chip>
            ))}
          </FilterRow>

          <FilterRow label="Net profit">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="min"
              className="num h-8 w-24"
              value={filters.minNet ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  minNet: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
            <Input
              type="number"
              inputMode="decimal"
              placeholder="max"
              className="num h-8 w-24"
              value={filters.maxNet ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  maxNet: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
            <span className="text-xs text-muted-foreground">
              Broker-reported net money (gross + swap + commission). Orders your broker never priced
              are excluded from a money range rather than counted as zero.
            </span>
          </FilterRow>

          {money$.length > 0 ? (
            <p className="num text-xs text-muted-foreground">
              Broker-reported net in this view:{" "}
              {money$
                .map((bucket) => `${bucket.net.toFixed(2)} ${bucket.currency} (${bucket.count})`)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {rows.length >= BROKER_ORDER_PAGE_SIZE ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-muted-foreground">
          This screen shows the newest {BROKER_ORDER_PAGE_SIZE} automatic orders. Older orders
          remain stored and are still valued by Performance, but are not in this view, its filters
          or its exports.
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
      ) : visible.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-4 py-10 text-center">
          <p className="num text-sm font-semibold text-foreground">NO ORDERS MATCH THESE FILTERS</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            None of the {rows.length} loaded orders match this filter combination. Clear the filters
            to see them again.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {pendingCount} {pendingCount === 1 ? "order in this view has" : "orders in this view have"}{" "}
              no closed broker result yet, so no outcome is claimed for{" "}
              {pendingCount === 1 ? "it" : "them"}.
            </p>
          ) : null}
          {layout === "table" ? (
            <OrderTable rows={visible} />
          ) : (
            visible.map((row) => <OrderCard key={row.key} row={row} />)
          )}
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="label-xs w-20 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "num rounded-sm border px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Compact broker-style table. Every column is broker-reported or blank. */
function OrderTable({ rows }: { rows: BrokerOrderView[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[1040px] text-left text-xs">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            {[
              "Time in",
              "Symbol",
              "Grade",
              "Side",
              "Volume",
              "Fill",
              "Exit",
              "Time out",
              "Gross",
              "Swap",
              "Commission",
              "Net",
              "Slippage",
              "R",
              "Status",
            ].map((header) => (
              <th key={header} className="label-xs px-2.5 py-2 font-normal whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="num">
          {rows.map((row) => {
            const digits = digitsFor(row.instrument);
            const slip = slippageText(row);
            const net = row.broker?.netProfit ?? null;
            return (
              <tr key={row.key} className="border-b border-border/60 last:border-0">
                <td className="px-2.5 py-2 whitespace-nowrap">
                  {when(row.broker?.entryAt ?? row.enqueuedAt)}
                </td>
                <td className="px-2.5 py-2 font-semibold whitespace-nowrap">{row.instrument}</td>
                <td
                  className="px-2.5 py-2"
                  title={
                    row.gradeSource === "recovered_from_enqueue_decision"
                      ? "Grade recovered from the decision log: the original setup row was deleted by retention, so only the grade P-Trades acted on is known. The detection time and plan geometry stay unavailable."
                      : undefined
                  }
                >
                  {row.grade === "Unknown" ? "—" : row.grade}
                  {row.gradeSource === "recovered_from_enqueue_decision" ? (
                    <span className="text-muted-foreground">*</span>
                  ) : null}
                </td>
                <td
                  className={cn(
                    "px-2.5 py-2",
                    row.direction === "long"
                      ? "text-success"
                      : row.direction === "short"
                        ? "text-destructive"
                        : "",
                  )}
                >
                  {row.direction ? row.direction.toUpperCase() : "—"}
                </td>
                <td className="px-2.5 py-2">{num(row.broker?.volume ?? row.submitted.volume, 2)}</td>
                <td className="px-2.5 py-2">{num(row.broker?.entryPrice, digits)}</td>
                <td className="px-2.5 py-2">{num(row.broker?.exitPrice, digits)}</td>
                <td className="px-2.5 py-2 whitespace-nowrap">{when(row.broker?.exitAt ?? null)}</td>
                <td className="px-2.5 py-2">{num(row.broker?.grossProfit, 2)}</td>
                <td className="px-2.5 py-2">{num(row.broker?.swap, 2)}</td>
                <td className="px-2.5 py-2">{num(row.broker?.commission, 2)}</td>
                <td
                  className={cn(
                    "px-2.5 py-2 font-semibold whitespace-nowrap",
                    net === null ? "" : net > 0 ? "text-success" : net < 0 ? "text-destructive" : "",
                  )}
                >
                  {money(net, row.broker?.currency)}
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap" title={slip.title}>
                  {slip.value}
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap" title={row.r.reason ?? undefined}>
                  {formatJournalR(row.r)}
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap" title={row.status.detail ?? undefined}>
                  {row.status.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrderCard({ row }: { row: BrokerOrderView }) {
  const digits = digitsFor(row.instrument);
  const long = row.direction === "long";
  const slip = slippageText(row);
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="grid gap-2 border-b border-border px-3 py-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="num text-sm font-bold">{row.instrument}</span>
          <span className="truncate text-xs text-muted-foreground">
            {INSTRUMENT_LABELS[row.instrument] ?? ""}
          </span>
          {row.grade !== "Unknown" ? <GradeBadge grade={row.grade} /> : null}
          {row.gradeSource === "recovered_from_enqueue_decision" ? (
            <span
              className="num rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
              title="The original setup row was deleted by retention. This grade was proved from the surviving decision log — a unique match on the broker order reference — so the grade is real while the detection time and plan geometry stay unavailable."
            >
              Grade recovered from decision log
            </span>
          ) : null}
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
          <span
            className="num rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
            title={
              row.destination.kind === "webhook_bridge"
                ? "This order was addressed to your outbound webhook, not to a connected broker account."
                : undefined
            }
          >
            {row.destination.label}
          </span>
          {row.dryRun ? (
            <span className="num rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {row.destination.kind === "webhook_bridge"
                ? "Dry run · not sent to your webhook"
                : "Dry run · not sent to a broker"}
            </span>
          ) : null}
          {row.accountType ? (
            <span className="num rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {row.accountType === "real" ? "Live account" : `${row.accountType} account`}
            </span>
          ) : null}
          <span className="num rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {row.entryMode === "market"
              ? "Market entry"
              : row.entryMode === "pending_limit"
                ? "Pending limit"
                : "Entry mode unavailable"}
          </span>
          {row.recovered ? (
            <span
              className="num rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning"
              title="Recovered from your broker's own deal history. The P-Trades order record for this trade no longer exists, so the detection time, submitted geometry and slippage are unavailable — only the broker's figures are shown. The grade is shown separately when the decision log proved it."
            >
              Recovered from broker records
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
        <Cell
          label={row.entryMode === "market" ? "Market reference" : "Submitted entry"}
          value={num(row.submitted.entry, digits)}
        />
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

      <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
        <Cell label="Broker gross" value={money(row.broker?.grossProfit, row.broker?.currency)} />
        <Cell label="Swap" value={num(row.broker?.swap, 2)} />
        <Cell label="Commission" value={num(row.broker?.commission, 2)} />
        <Cell
          label={
            row.broker?.slippage.basis === "published"
              ? "Slippage vs published entry"
              : "Slippage vs submitted entry"
          }
          value={slip.value}
          title={slip.title}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-xs sm:px-4">
        <span className="label-xs">
          {row.status.kind === "not_sent" ? "P-Trades check" : "Broker result"}
        </span>
        {row.broker ? (
          <>
            <span className="num text-foreground">
              {row.broker.state === "closed" ? "Closed" : "Open"} ·{" "}
              {row.broker.netProfit == null
                ? "profit not reported"
                : `net ${money(row.broker.netProfit, row.broker.currency)}`}
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

function Cell({
  label,
  value,
  className,
  title,
}: {
  label: string;
  value: string;
  className?: string;
  title?: string | undefined;
}) {
  return (
    <div className="bg-card px-4 py-2.5" title={title}>
      <p className="label-xs">{label}</p>
      <p className={cn("num text-sm font-semibold", className)}>{value}</p>
    </div>
  );
}
