import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, Download, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { deleteAllTrades, deleteTrade, takenTradeHistoryQuery, updateTradeResult } from "@/lib/queries";
import { INSTRUMENT_LABELS, type Outcome, type SignalRow, type TradeHistoryRow } from "@/lib/db-types";
import { downloadCsv, downloadJson, historyToCsv, historyToExportJson, todayStamp } from "@/lib/export";
import { GradeBadge } from "@/components/SignalCard";
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

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "Trade History — P-Trades Hub" },
      {
        name: "description",
        content: "Every setup you logged as taken, with entry, stop, targets, R:R and the recorded outcome.",
      },
      { property: "og:title", content: "Trade History — P-Trades Hub" },
      { property: "og:description", content: "Your permanent log of taken forex trades and their outcomes." },
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

function HistoryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const history = useQuery(takenTradeHistoryQuery(user?.id));
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(
    () => (history.data ?? []).filter((r) => signalOf(r) !== null),
    [history.data],
  );

  function exportCsv() {
    if (rows.length === 0) return;
    downloadCsv(`ptrades_trade_history_${todayStamp()}.csv`, historyToCsv(rows));
  }

  function exportJson() {
    if (rows.length === 0) return;
    downloadJson(`ptrades_trade_history_${todayStamp()}.json`, historyToExportJson(rows));
  }

  async function record(tradeId: string, outcome: Outcome, r: number | null) {
    setBusyId(tradeId);
    try {
      await updateTradeResult({ tradeId, outcome, realizedR: r });
      await queryClient.invalidateQueries({ queryKey: ["taken-trade-history"] });
      await queryClient.invalidateQueries({ queryKey: ["my-trades"] });
      toast.success("Outcome updated");
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
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Trade History</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every setup you logged as taken is kept here for good, even after it leaves the signal feed. Skipped
          setups are not retained.
        </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button size="sm" variant="ghost" disabled={rows.length === 0} onClick={exportCsv}>
            <Download className="size-4" /> Export History (CSV)
          </Button>
          <Button size="sm" variant="ghost" disabled={rows.length === 0} onClick={exportJson}>
            <Download className="size-4" /> Export History (JSON)
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={rows.length === 0 || busyId === "all"}
              >
                <Trash2 className="size-4" /> Delete all history
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your entire trade history?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes {rows.length} logged {rows.length === 1 ? "trade" : "trades"} from your
                  personal log. Scanner signals and learning data are not affected. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep history</AlertDialogCancel>
                <AlertDialogAction onClick={() => void removeAll()}>Delete everything</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {history.isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Could not load your trade history. Try refreshing.
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-4 py-10 text-center sm:px-6 sm:py-16">
          <p className="num text-lg font-semibold text-foreground">NO TAKEN TRADES YET</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            When you press "Log as Taken" on a setup in the signal feed, it appears here permanently.
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
                      {long ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                      {long ? "LONG" : "SHORT"}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-3 sm:ml-auto sm:shrink-0">
                    <span className={cn("num text-xs font-semibold uppercase", OUTCOME_STYLES[row.outcome])}>
                      {row.outcome}
                      {row.realized_r_multiple != null
                        ? ` · ${Number(row.realized_r_multiple).toFixed(2)}R`
                        : ""}
                    </span>
                    <span className="num hidden text-xs text-muted-foreground sm:inline">
                      {new Date(signal.detected_at).toLocaleString(undefined, {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
                  <Cell label="Entry" value={p(signal.entry_price)} />
                  <Cell label="Stop-loss" value={p(signal.stop_loss)} className="text-destructive" />
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
                  key={`${row.id}-${row.outcome}-${row.realized_r_multiple ?? "none"}`}
                  busy={busyId === row.id}
                  outcome={row.outcome}
                  realizedR={row.realized_r_multiple}
                  onSubmit={(outcome, r) => void record(row.id, outcome, r)}
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

function OutcomeEditor({
  outcome,
  realizedR,
  busy,
  onSubmit,
}: {
  outcome: Outcome;
  realizedR: number | null;
  busy: boolean;
  onSubmit: (outcome: Outcome, r: number | null) => void;
}) {
  const [r, setR] = useState(realizedR != null ? String(realizedR) : "");
  // Expand-to-edit: an always-open editor on every row reads like unsaved work.
  const [editing, setEditing] = useState(false);

  const parsed = r.trim() === "" ? null : Number(r);
  const valid = parsed === null || Number.isFinite(parsed);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4">
        <span className="label-xs">Recorded result</span>
        <span className="num text-xs text-foreground">
          {outcome === "open"
            ? "Still open"
            : `${outcome.toUpperCase()}${realizedR != null ? ` · ${Number(realizedR).toFixed(2)}R` : ""}`}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" /> Edit outcome
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-border px-3 py-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0 sm:px-4">
      <span className="label-xs block sm:mr-1">Record result</span>
      <Input
        value={r}
        onChange={(e) => setR(e.target.value)}
        inputMode="decimal"
        placeholder="R multiple"
        aria-label="Realized R multiple"
        className="num h-10 w-full sm:h-8 sm:w-28"
      />
      <div className="grid grid-cols-2 gap-2 sm:contents">
        {(["win", "loss", "breakeven", "open"] as const).map((o) => (
          <Button
            key={o}
            size="sm"
            variant={o === outcome ? "default" : "outline"}
            disabled={busy || !valid}
            className="h-10 w-full sm:h-8 sm:w-auto"
            onClick={() => {
              onSubmit(o, o === "open" ? null : parsed);
              setEditing(false);
            }}
          >
            {o === "breakeven" ? "Break-even" : o[0]!.toUpperCase() + o.slice(1)}
          </Button>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="h-10 w-full sm:h-8 sm:w-auto" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {!valid ? <span className="text-xs text-destructive">Enter a number</span> : null}
    </div>
  );
}
