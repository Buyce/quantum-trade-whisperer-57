import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { takenTradeHistoryQuery, updateTradeResult } from "@/lib/queries";
import { INSTRUMENT_LABELS, type Outcome, type SignalRow, type TradeHistoryRow } from "@/lib/db-types";
import { GradeBadge } from "@/components/SignalCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <div>
        <p className="label-xs">Permanent record</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Trade History</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every setup you logged as taken is kept here for good, even after it leaves the signal feed. Skipped
          setups are not retained.
        </p>
      </div>

      {history.isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Could not load your trade history. Try refreshing.
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-6 py-16 text-center">
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
                <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
                  <span className="num text-sm font-bold">{signal.instrument}</span>
                  <span className="text-xs text-muted-foreground">
                    {INSTRUMENT_LABELS[signal.instrument] ?? ""}
                  </span>
                  <GradeBadge grade={signal.grade} />
                  <span
                    className={cn(
                      "num inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs",
                      long
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-destructive/40 bg-destructive/10 text-destructive",
                    )}
                  >
                    {long ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                    {long ? "LONG" : "SHORT"}
                  </span>
                  <span className={cn("num ml-auto text-xs font-semibold uppercase", OUTCOME_STYLES[row.outcome])}>
                    {row.outcome}
                    {row.realized_r_multiple != null ? ` · ${Number(row.realized_r_multiple).toFixed(2)}R` : ""}
                  </span>
                  <span className="num text-xs text-muted-foreground">
                    {new Date(signal.detected_at).toLocaleString(undefined, {
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
                  <Cell label="Entry" value={p(signal.entry_price)} />
                  <Cell label="Stop-loss" value={p(signal.stop_loss)} className="text-destructive" />
                  <Cell label="TP1 · 1:1" value={p(signal.tp1)} className="text-success" />
                  <Cell label="TP2 · 1:2" value={p(signal.tp2)} className="text-success" />
                  <Cell label="TP3 · 1:3" value={p(signal.tp3)} className="text-success" />
                  <Cell label="R:R" value={Number(signal.rr_ratio).toFixed(2)} />
                </div>

                <OutcomeEditor
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

  const parsed = r.trim() === "" ? null : Number(r);
  const valid = parsed === null || Number.isFinite(parsed);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="label-xs mr-1">Record result</span>
      <Input
        value={r}
        onChange={(e) => setR(e.target.value)}
        inputMode="decimal"
        placeholder="R multiple"
        aria-label="Realized R multiple"
        className="num h-8 w-28"
      />
      {(["win", "loss", "breakeven", "open"] as const).map((o) => (
        <Button
          key={o}
          size="sm"
          variant={o === outcome ? "default" : "outline"}
          disabled={busy || !valid}
          onClick={() => onSubmit(o, o === "open" ? null : parsed)}
        >
          {o === "breakeven" ? "Break-even" : o[0]!.toUpperCase() + o.slice(1)}
        </Button>
      ))}
      {!valid ? <span className="text-xs text-destructive">Enter a number</span> : null}
    </div>
  );
}
