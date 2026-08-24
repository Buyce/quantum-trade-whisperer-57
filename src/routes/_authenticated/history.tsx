import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Download,
  Pencil,
  ShieldAlert,
  Trash2,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  deleteAllTrades,
  deleteTrade,
  takenTradeHistoryQuery,
  TRADE_HISTORY_PAGE_SIZE,
} from "@/lib/queries";
import { recordTradeOutcome } from "@/lib/trade-journal.functions";
import {
  INSTRUMENT_LABELS,
  type Outcome,
  type SignalRow,
  type TradeHistoryRow,
} from "@/lib/db-types";
import {
  downloadCsv,
  downloadJson,
  historyToCsv,
  historyToExportJson,
  todayStamp,
} from "@/lib/export";
import { GradeBadge } from "@/components/SignalCard";
import { GuideNote } from "@/components/GuideMode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatJournalR, journalRView } from "@/lib/journal/display";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "Trade History — P-Trades Hub" },
      {
        name: "description",
        content:
          "Every setup you logged as taken, with entry, stop, targets, R:R and the recorded outcome.",
      },
      { property: "og:title", content: "Trade History — P-Trades Hub" },
      {
        property: "og:description",
        content: "Your permanent log of taken forex trades and their outcomes.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HistoryPage,
});

function signalOf(row: TradeHistoryRow): SignalRow | null {
  const s = row.scanned_signals;
  if (!s) return null;
  return Array.isArray(s) ? (s[0] ?? null) : s;
}

function price(v: number, instrument: string) {
  return instrument === "XAUUSD" ? Number(v).toFixed(2) : Number(v).toFixed(5);
}

const OUTCOME_STYLES: Record<Outcome, string> = {
  win: "text-success",
  loss: "text-destructive",
  breakeven: "text-muted-foreground",
  open: "text-warning",
};

/** A closed trade without both real fill prices cannot have an auditable R. */
function isMissingPrices(row: TradeHistoryRow) {
  return (
    row.outcome !== "open" && (row.actual_entry_price == null || row.actual_exit_price == null)
  );
}

/**
 * Who entered the fill prices. Provenance is stamped server-side, so this label
 * is a fact about the write, not a guess: an assistant cannot present its own
 * numbers as yours.
 */
function PriceProvenanceBadge({ row }: { row: TradeHistoryRow }) {
  if (isMissingPrices(row) || row.outcome === "open") return null;
  const agent = row.price_source === "agent";
  const when = row.price_recorded_at ? new Date(row.price_recorded_at).toLocaleString() : null;
  const title = agent
    ? `Self-reported prices entered by an AI assistant — not broker verified${row.price_source_client ? ` (client ${row.price_source_client})` : ""}${when ? ` on ${when}` : ""}`
    : `Self-reported prices you entered in the terminal — not broker verified${when ? ` on ${when}` : ""}`;
  return (
    <span
      title={title}
      className={cn(
        "num inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px]",
        agent
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-success/40 bg-success/10 text-success",
      )}
    >
      {agent ? <Bot className="size-3" /> : <UserRound className="size-3" />}
      Self-reported · {agent ? "agent" : "you"}
    </span>
  );
}

function HistoryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const history = useQuery(takenTradeHistoryQuery(user?.id));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [onlyMissingPrices, setOnlyMissingPrices] = useState(false);

  const allRows = useMemo(
    () => (history.data ?? []).filter((r) => signalOf(r) !== null),
    [history.data],
  );
  const missingPricesCount = useMemo(() => allRows.filter(isMissingPrices).length, [allRows]);
  const rows = useMemo(
    () => (onlyMissingPrices ? allRows.filter(isMissingPrices) : allRows),
    [allRows, onlyMissingPrices],
  );

  function exportCsv() {
    if (allRows.length === 0) return;
    downloadCsv(`ptrades_trade_history_${todayStamp()}.csv`, historyToCsv(allRows));
  }

  function exportJson() {
    if (allRows.length === 0) return;
    downloadJson(`ptrades_trade_history_${todayStamp()}.json`, historyToExportJson(allRows));
  }

  async function record(
    tradeId: string,
    outcome: Outcome,
    entryPrice: number | null,
    exitPrice: number | null,
  ) {
    setBusyId(tradeId);
    try {
      const res = await recordTradeOutcome({
        data: { tradeId, outcome, actualEntryPrice: entryPrice, actualExitPrice: exitPrice },
      });
      await queryClient.invalidateQueries({ queryKey: ["taken-trade-history"] });
      await queryClient.invalidateQueries({ queryKey: ["my-trades"] });
      if (res.alreadyResolved) {
        toast.info(res.message);
      } else {
        const r = res.rVsActualRisk ?? res.rVsPlan;
        const basis = res.rVsActualRisk != null ? "R vs actual risk" : "R vs plan";
        toast.success(
          r != null
            ? `Outcome updated · ${r.toFixed(2)}R (${basis})`
            : "Outcome updated. Add your entry and exit price to record the R.",
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the outcome");
    } finally {
      setBusyId(null);
    }
  }

  async function removeOne(tradeId: string) {
    setBusyId(tradeId);
    try {
      await deleteTrade({ tradeId });
      await refreshAfterDelete();
      toast.success("Trade deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the trade");
    } finally {
      setBusyId(null);
    }
  }

  async function removeAll() {
    if (!user?.id) return;
    setBusyId("all");
    try {
      await deleteAllTrades({ userId: user.id });
      await refreshAfterDelete();
      toast.success("Trade history cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not clear your history");
    } finally {
      setBusyId(null);
    }
  }

  async function refreshAfterDelete() {
    await queryClient.invalidateQueries({ queryKey: ["taken-trade-history"] });
    await queryClient.invalidateQueries({ queryKey: ["my-trades"] });
    await queryClient.invalidateQueries({ queryKey: ["signals"] });
  }

  if (history.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:flex sm:flex-wrap sm:items-start">
        <div className="min-w-0">
          <p className="label-xs">Permanent record</p>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Trade History
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every setup you logged as taken is kept here for good, even after it leaves the signal
            feed. Skipped setups are not retained.
          </p>
          <GuideNote anchor="two-r" className="mt-3 max-w-2xl">
            The plan is snapshotted when you log a trade, so a later expiry cannot change what your
            trade is measured against. Add your real entry and exit to get R. Prices you or your
            assistant enter are self-reported and stamped with their author — a blank R means an
            input is genuinely missing, and nothing is estimated.
          </GuideNote>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button size="sm" variant="ghost" disabled={allRows.length === 0} onClick={exportCsv}>
            <Download className="size-4" /> Export visible rows (CSV)
          </Button>
          <Button size="sm" variant="ghost" disabled={allRows.length === 0} onClick={exportJson}>
            <Download className="size-4" /> Export visible rows (JSON)
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={allRows.length === 0 || busyId === "all"}
              >
                <Trash2 className="size-4" /> Delete all history
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your entire trade history?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes every logged trade from your personal log, including
                  older rows not visible on this page. Scanner signals and learning data are not
                  affected. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep history</AlertDialogCancel>
                <AlertDialogAction onClick={() => void removeAll()}>
                  Delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {(history.data?.length ?? 0) >= TRADE_HISTORY_PAGE_SIZE ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-muted-foreground">
          This screen currently shows the newest {TRADE_HISTORY_PAGE_SIZE} taken trades. Older rows
          remain stored, but are not included in the visible-row exports or counts on this page.
          Journal Performance pages through the complete population separately and refuses partial
          metrics.
        </p>
      ) : null}

      {missingPricesCount > 0 ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {missingPricesCount} closed {missingPricesCount === 1 ? "trade has" : "trades have"}{" "}
                execution prices missing
              </p>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                Add the entry and exit price you actually got and the R multiple is recalculated
                from the setup's own risk distance. Until then those results have execution prices
                missing and are excluded from your price-backed win rate. Prices are optional —
                nothing is changed if you skip this. Prices you or an assistant enter are
                self-reported, never broker verified.
              </p>
            </div>
            <Button
              size="sm"
              variant={onlyMissingPrices ? "default" : "outline"}
              className="sm:ml-auto"
              onClick={() => setOnlyMissingPrices((v) => !v)}
            >
              {onlyMissingPrices ? "Show all trades" : "Show only trades missing prices"}
            </Button>
          </div>
        </div>
      ) : null}

      {history.isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Could not load your trade history. Try refreshing.
        </p>
      ) : allRows.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-4 py-10 text-center sm:px-6 sm:py-16">
          <p className="num text-lg font-semibold text-foreground">NO TAKEN TRADES YET</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            When you press "Log as Taken" on a setup in the signal feed, it appears here
            permanently.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const signal = signalOf(row)!;
            const long = signal.direction === "long";
            const p = (v: number) => price(v, signal.instrument);
            return (
              <div key={row.id} className="rounded-md border border-border bg-card">
                <div className="grid gap-2 border-b border-border px-3 py-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:px-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="num text-sm font-bold">{signal.instrument}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {INSTRUMENT_LABELS[signal.instrument] ?? ""}
                    </span>
                    <GradeBadge grade={signal.grade} />
                    <span
                      className={cn(
                        "num inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs",
                        long
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-destructive/40 bg-destructive/10 text-destructive",
                      )}
                    >
                      {long ? (
                        <ArrowUpRight className="size-3" />
                      ) : (
                        <ArrowDownRight className="size-3" />
                      )}
                      {long ? "LONG" : "SHORT"}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-3 sm:ml-auto sm:shrink-0">
                    <span
                      className={cn(
                        "num text-xs font-semibold uppercase",
                        OUTCOME_STYLES[row.outcome],
                      )}
                    >
                      {row.outcome}
                      {(() => {
                        const view = journalRView(row, "actual_risk");
                        if (view.value === null) return "";
                        return ` · ${formatJournalR(view)}${view.provenance === "legacy" ? " (legacy)" : ""}`;
                      })()}
                    </span>
                    <PriceProvenanceBadge row={row} />

                    <span className="num hidden text-xs text-muted-foreground sm:inline">
                      {new Date(signal.detected_at).toLocaleString(undefined, {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          disabled={busyId === row.id}
                          aria-label={`Delete ${signal.instrument} trade`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this trade?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {signal.instrument} {long ? "long" : "short"} from{" "}
                            {new Date(signal.detected_at).toLocaleString()} will be permanently
                            removed from your trade log. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void removeOne(row.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
                  <Cell label="Entry" value={p(signal.entry_price)} />
                  <Cell
                    label="Stop-loss"
                    value={p(signal.stop_loss)}
                    className="text-destructive"
                  />
                  <Cell
                    label={`TP1 · 1:${Number(signal.tp1_r ?? 1).toFixed(signal.tp1_r === null ? 0 : 2)}`}
                    value={p(signal.tp1)}
                    className="text-success"
                  />
                  <Cell
                    label={`TP2 · 1:${Number(signal.tp2_r ?? 2).toFixed(signal.tp2_r === null ? 0 : 2)}`}
                    value={p(signal.tp2)}
                    className="text-success"
                  />
                  {signal.tp3 !== null ? (
                    <Cell
                      label={`TP3 · 1:${Number(signal.tp3_r ?? 3).toFixed(signal.tp3_r === null ? 0 : 2)}`}
                      value={p(signal.tp3)}
                      className="text-success"
                    />
                  ) : null}
                  <Cell label="R:R" value={Number(signal.rr_ratio).toFixed(2)} />
                </div>

                <OutcomeEditor
                  key={`${row.id}-${row.outcome}-${row.r_vs_actual_risk ?? row.derived_r ?? "none"}`}
                  busy={busyId === row.id}
                  outcome={row.outcome}
                  realizedR={journalRView(row, "actual_risk").value}
                  entryPrice={row.actual_entry_price}
                  exitPrice={row.actual_exit_price}
                  decimals={signal.instrument === "XAUUSD" ? 2 : 5}
                  onSubmit={(outcome, entry, exit) => void record(row.id, outcome, entry, exit)}
                />
              </div>
            );
          })}
        </div>
      )}
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

/**
 * The R multiple is not an input any more. Users log the prices they actually
 * got and the server derives R from the setup's own risk distance, so the
 * number is reproducible instead of self-reported.
 */
function OutcomeEditor({
  outcome,
  realizedR,
  entryPrice,
  exitPrice,
  decimals,
  busy,
  onSubmit,
}: {
  outcome: Outcome;
  realizedR: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  decimals: number;
  busy: boolean;
  onSubmit: (outcome: Outcome, entry: number | null, exit: number | null) => void;
}) {
  const [entry, setEntry] = useState(entryPrice != null ? String(entryPrice) : "");
  const [exit, setExit] = useState(exitPrice != null ? String(exitPrice) : "");
  // Expand-to-edit: an always-open editor on every row reads like unsaved work.
  const [editing, setEditing] = useState(false);

  const parse = (v: string) => (v.trim() === "" ? null : Number(v));
  const parsedEntry = parse(entry);
  const parsedExit = parse(exit);
  const okNumber = (v: number | null) => v === null || (Number.isFinite(v) && v > 0);
  const valid = okNumber(parsedEntry) && okNumber(parsedExit);
  const partial = (parsedEntry === null) !== (parsedExit === null);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4">
        <span className="label-xs">Recorded result</span>
        <span className="num text-xs text-foreground">
          {outcome === "open"
            ? "Still open"
            : `${outcome.toUpperCase()}${realizedR != null ? ` · ${Number(realizedR).toFixed(2)}R` : ""}`}
        </span>
        {outcome !== "open" && realizedR == null ? (
          <span className="text-xs text-warning">no prices logged — R unknown</span>
        ) : null}
        {entryPrice != null && exitPrice != null ? (
          <span className="num text-xs text-muted-foreground">
            in {Number(entryPrice).toFixed(decimals)} → out {Number(exitPrice).toFixed(decimals)}
          </span>
        ) : null}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" /> Edit outcome
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-border px-3 py-3 sm:px-4">
      <div className="space-y-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3 sm:space-y-0">
        <label className="block">
          <span className="label-xs block">Actual entry price</span>
          <Input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            inputMode="decimal"
            placeholder="your fill"
            aria-label="Actual entry price"
            className="num mt-1 h-10 w-full sm:h-8 sm:w-32"
          />
        </label>
        <label className="block">
          <span className="label-xs block">Actual exit price</span>
          <Input
            value={exit}
            onChange={(e) => setExit(e.target.value)}
            inputMode="decimal"
            placeholder="your close"
            aria-label="Actual exit price"
            className="num mt-1 h-10 w-full sm:h-8 sm:w-32"
          />
        </label>
        <p className="text-xs text-muted-foreground sm:max-w-xs">
          Optional, but with both prices your R multiple is calculated from the setup's real risk
          distance instead of being estimated.
        </p>
      </div>

      <div className="space-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0">
        <span className="label-xs block sm:mr-1">Record result</span>
        <div className="grid grid-cols-2 gap-2 sm:contents">
          {(["win", "loss", "breakeven", "open"] as const).map((o) => (
            <Button
              key={o}
              size="sm"
              variant={o === outcome ? "default" : "outline"}
              disabled={busy || !valid}
              className="h-10 w-full sm:h-8 sm:w-auto"
              onClick={() => {
                onSubmit(o, o === "open" ? null : parsedEntry, o === "open" ? null : parsedExit);
                setEditing(false);
              }}
            >
              {o === "breakeven" ? "Break-even" : o[0]!.toUpperCase() + o.slice(1)}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-10 w-full sm:h-8 sm:w-auto"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
      {!valid ? (
        <p className="text-xs text-destructive">Prices must be positive numbers.</p>
      ) : partial ? (
        <p className="text-xs text-warning">Both prices are needed to calculate the R multiple.</p>
      ) : null}
    </div>
  );
}
