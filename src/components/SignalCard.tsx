import { ArrowDownRight, ArrowUpRight, Check, X } from "lucide-react";
import { contextOf, INSTRUMENT_LABELS, SESSION_LABELS, type SignalRow, type TradeRow } from "@/lib/db-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const GRADE_STYLES: Record<string, string> = {
  "A+": "bg-grade-aplus/15 text-grade-aplus border-grade-aplus/50",
  A: "bg-grade-a/15 text-grade-a border-grade-a/40",
  B: "bg-grade-b/15 text-grade-b border-grade-b/40",
  C: "bg-grade-c/15 text-grade-c border-grade-c/40",
};

export function GradeBadge({ grade }: { grade: string }) {
  return (
    <span
      className={cn(
        "num inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-bold",
        GRADE_STYLES[grade] ?? "",
      )}
    >
      {grade === "A+" ? "A+ GRADE" : `${grade}-GRADE`}
    </span>
  );
}


function price(v: number, instrument: string) {
  return instrument === "XAUUSD" ? Number(v).toFixed(2) : Number(v).toFixed(5);
}

export function SignalCard({
  signal,
  trade,
  onDecision,
  onResult,
  busy,
}: {
  signal: SignalRow;
  trade: TradeRow | undefined;
  onDecision: (decision: "taken" | "skipped") => void;
  onResult: (outcome: "win" | "loss" | "breakeven", r: number) => void;
  busy: boolean;
}) {
  const ctx = contextOf(signal);
  const long = signal.direction === "long";
  const conf = Number(signal.confidence_score);

  return (
    <article className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="num text-base font-bold text-foreground">{signal.instrument}</span>
          <span className="text-xs text-muted-foreground">
            {INSTRUMENT_LABELS[signal.instrument] ?? ""}
          </span>
        </div>
        <GradeBadge grade={signal.grade} />
        <span
          className={cn(
            "num inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold",
            long ? "bg-long/15 text-long" : "bg-short/15 text-short",
          )}
        >
          {long ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {long ? "LONG" : "SHORT"}
        </span>
        {ctx ? (
          <Badge variant="outline" className="num text-xs font-normal">
            {SESSION_LABELS[ctx.trading_session] ?? ctx.trading_session}
          </Badge>
        ) : null}
        <span className="num ml-auto text-xs text-muted-foreground">
          {new Date(signal.detected_at).toLocaleString(undefined, {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Entry (M15 break)" value={price(signal.entry_price, signal.instrument)} />
        <Metric label="Stop-loss" value={price(signal.stop_loss, signal.instrument)} tone="short" />
        <Metric label="TP1 · 1:1" value={price(signal.tp1, signal.instrument)} tone="long" />
        <Metric label="TP2 · 1:2" value={price(signal.tp2, signal.instrument)} tone="long" />
        <Metric label="TP3 · 1:3" value={price(signal.tp3, signal.instrument)} tone="long" />
        <Metric label="R:R" value={`${Number(signal.rr_ratio).toFixed(2)}`} />
      </div>

      <div className="grid gap-4 border-t border-border px-4 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <p className="label-xs">Qualitative breakdown</p>
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">{signal.qualitative_breakdown}</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span className="num">H4: {signal.h4_bias ?? "—"}</span>
            <span className="num">H1: {signal.h1_bias ?? "—"}</span>
            <span className="num">M15: {signal.m15_bias ?? "—"}</span>
            <span className="num">ATR: {Number(signal.atr).toFixed(5)}</span>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <p className="label-xs">Confidence</p>
            <span className="num text-xl font-bold text-primary">{conf.toFixed(1)}%</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, conf)}%` }} />
          </div>
          <dl className="mt-3 space-y-1.5">
            <Component label="Timeframe alignment" weight="40%" value={Number(signal.c_alignment)} />
            <Component label="R:R ratio" weight="30%" value={Number(signal.c_rr)} />
            <Component label="Pattern symmetry" weight="20%" value={Number(signal.c_symmetry)} />
            <Component label="Volatility context" weight="10%" value={Number(signal.c_volatility)} />
          </dl>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface/50 px-4 py-3">
        {!trade ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => onDecision("taken")}>
              <Check className="size-4" /> Log as Taken
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecision("skipped")}>
              <X className="size-4" /> Log as Skipped
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              No-Trade is the default. Nothing here is an instruction to execute.
            </span>
          </>
        ) : (
          <>
            <Badge variant={trade.user_decision === "taken" ? "default" : "secondary"} className="num">
              {trade.user_decision === "taken" ? "TAKEN" : "SKIPPED"}
            </Badge>
            {trade.user_decision === "taken" && trade.outcome === "open" ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="label-xs">Close at</span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onResult("win", 1)}>
                  +1R
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onResult("win", 2)}>
                  +2R
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onResult("win", 3)}>
                  +3R
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onResult("breakeven", 0)}>
                  BE
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onResult("loss", -1)}
                  className="text-short"
                >
                  −1R
                </Button>
              </div>
            ) : trade.user_decision === "taken" ? (
              <span
                className={cn(
                  "num text-sm font-semibold",
                  (trade.realized_r_multiple ?? 0) > 0
                    ? "text-long"
                    : (trade.realized_r_multiple ?? 0) < 0
                      ? "text-short"
                      : "text-muted-foreground",
                )}
              >
                {trade.outcome.toUpperCase()} · {Number(trade.realized_r_multiple ?? 0).toFixed(2)}R
              </span>
            ) : null}
            <span className="num ml-auto text-xs text-muted-foreground">
              Scanner outcome: {signal.resolved_outcome === "open" ? "still open" : `${signal.resolved_outcome} ${Number(signal.resolved_r_multiple ?? 0).toFixed(2)}R`}
            </span>
          </>
        )}
      </div>
    </article>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "long" | "short" }) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="label-xs">{label}</p>
      <p
        className={cn(
          "num mt-1 text-sm font-semibold",
          tone === "long" ? "text-long" : tone === "short" ? "text-short" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Component({ label, weight, value }: { label: string; weight: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="flex-1 text-xs text-muted-foreground">
        {label} <span className="num opacity-60">{weight}</span>
      </dt>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-accent" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <dd className="num w-10 text-right text-xs text-foreground">{value.toFixed(0)}</dd>
    </div>
  );
}
