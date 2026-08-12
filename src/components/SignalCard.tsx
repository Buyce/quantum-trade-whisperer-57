import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { contextOf, INSTRUMENT_LABELS, SESSION_LABELS, type SignalRow, type TradeRow } from "@/lib/db-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoLabel, useGuideMode } from "@/components/GuideMode";

const GRADE_STYLES: Record<string, string> = {
  "A+": "bg-grade-aplus/15 text-grade-aplus border-grade-aplus/50",
  A: "bg-grade-a/15 text-grade-a border-grade-a/40",
  B: "bg-grade-b/15 text-grade-b border-grade-b/40",
  C: "bg-grade-c/15 text-grade-c border-grade-c/40",
};

/** Left rail accent — the fastest way to read priority when scanning a stack. */
const GRADE_RAIL: Record<string, string> = {
  "A+": "bg-grade-aplus",
  A: "bg-grade-a",
  B: "bg-grade-b",
  C: "bg-grade-c/60",
};

export function GradeBadge({ grade }: { grade: string }) {
  return (
    <span
      className={cn(
        "num inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-xs font-bold",
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

/** Compact age so the summary row stays scannable at mobile widths. */
function age(detectedAt: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(detectedAt).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
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
  const { guide } = useGuideMode();
  const orderType = long ? "BUY LIMIT" : "SELL LIMIT";
  // Progressive disclosure: the top tier opens by default because it is the one
  // setup a trader always wants the detail on; everything else starts collapsed.
  const [open, setOpen] = useState(signal.grade === "A+");
  const detailId = `signal-detail-${signal.id}`;

  async function copyOrder() {
    const p = (v: number) => price(v, signal.instrument);
    const text = [
      `${signal.instrument} — ${orderType} (${long ? "LONG" : "SHORT"})`,
      `Entry:      ${p(signal.entry_price)}`,
      `Stop-loss:  ${p(signal.stop_loss)}`,
      `TP1 (1:1):  ${p(signal.tp1)}`,
      `TP2 (1:2):  ${p(signal.tp2)}`,
      `TP3 (1:3):  ${p(signal.tp3)}`,
      `R:R:        ${Number(signal.rr_ratio).toFixed(2)}`,
      `Confidence: ${conf.toFixed(1)}%  ·  Grade ${signal.grade}`,
      `Not financial advice — size the position yourself.`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Order details copied");
    } catch {
      toast.error("Clipboard blocked by your browser");
    }
  }

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-md border bg-card pl-1 transition-colors",
        signal.grade === "A+"
          ? "border-grade-aplus/45 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-grade-aplus)_18%,transparent)]"
          : "border-border",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-1", GRADE_RAIL[signal.grade] ?? "bg-border")}
      />

      {/* Summary row: the only thing rendered until the user asks for more. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface/60"
      >
        <div className="grid min-w-0 flex-1 gap-1.5 sm:flex sm:items-center sm:gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="num truncate text-base font-bold text-foreground">{signal.instrument}</span>
            <GradeBadge grade={signal.grade} />
            <span
              className={cn(
                "num inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold",
                long ? "bg-long/15 text-long" : "bg-short/15 text-short",
              )}
            >
              {long ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {long ? "LONG" : "SHORT"}
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:ml-auto">
            <span className="num">
              R:R <span className="font-semibold text-foreground">{Number(signal.rr_ratio).toFixed(2)}</span>
            </span>
            <span className="num">
              Conf <span className="font-semibold text-primary">{conf.toFixed(0)}%</span>
            </span>
            <span className="num">
              Entry{" "}
              <span className="font-semibold text-foreground">
                {price(signal.entry_price, signal.instrument)}
              </span>
            </span>
            <span className="num">{age(signal.detected_at)} ago</span>
            {trade ? (
              <Badge variant={trade.user_decision === "taken" ? "default" : "secondary"} className="num">
                {trade.user_decision === "taken" ? "TAKEN" : "SKIPPED"}
              </Badge>
            ) : null}
          </div>
        </div>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div id={detailId} className="border-t border-border">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
            <span>{INSTRUMENT_LABELS[signal.instrument] ?? ""}</span>
            {guide ? (
              <Badge variant="outline" className="num font-normal">
                {orderType}
              </Badge>
            ) : null}
            {ctx ? (
              <Badge variant="outline" className="num font-normal">
                {SESSION_LABELS[ctx.trading_session] ?? ctx.trading_session}
              </Badge>
            ) : null}
            <span className="num ml-auto">
              {new Date(signal.detected_at).toLocaleString(undefined, {
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
            <Metric
              label="Entry (M15 break)"
              hint="The price to place your pending order at — where the 15-minute chart broke structure."
              value={price(signal.entry_price, signal.instrument)}
            />
            <Metric
              label="Stop-loss"
              hint="Where the plan is wrong. Place this order with the trade: it caps the loss at 1R."
              value={price(signal.stop_loss, signal.instrument)}
              tone="short"
            />
            <Metric
              label="TP1 · 1:1"
              hint="First take-profit. Closing here returns the same amount you risked (+1R)."
              value={price(signal.tp1, signal.instrument)}
              tone="long"
            />
            <Metric
              label="TP2 · 1:2"
              hint="Second take-profit — twice what you risked (+2R)."
              value={price(signal.tp2, signal.instrument)}
              tone="long"
            />
            <Metric
              label="TP3 · 1:3"
              hint="Final take-profit — three times what you risked (+3R)."
              value={price(signal.tp3, signal.instrument)}
              tone="long"
            />
            <Metric
              label="R:R"
              hint="Risk-to-reward: how much this setup can win compared to what it risks. Higher is better."
              value={`${Number(signal.rr_ratio).toFixed(2)}`}
            />
          </div>

          <div className="grid gap-4 border-t border-border px-4 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <p className="label-xs">Qualitative breakdown</p>
              <p className="mt-2 text-sm leading-relaxed text-foreground/90">{signal.qualitative_breakdown}</p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span className="num">H4: {signal.h4_bias ?? "—"}</span>
                <span className="num">H1: {signal.h1_bias ?? "—"}</span>
                <span className="num">M15: {signal.m15_bias ?? "—"}</span>
                <span className="num">ATR: {Number(signal.atr).toFixed(5)}</span>
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex items-baseline justify-between">
                <p className="label-xs">
                  <InfoLabel hint="How strongly this setup matched the model's rules. It is a quality score, not a probability of profit.">
                    Confidence
                  </InfoLabel>
                </p>
                <span className="num text-xl font-bold text-primary">{conf.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, conf)}%` }} />
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <p className="label-xs">
                  <InfoLabel hint="Four independent checks the setup must satisfy. All four passing is what earns the A+ tier.">
                    Confluence pillars
                  </InfoLabel>
                </p>
                <span className="num text-xs text-muted-foreground">{signal.pillars_passed ?? "—"}/4 passed</span>
              </div>
              <dl className="mt-2 space-y-1.5">
                {/* Pillars are only ever shown from pillar columns. Older rows predate
                    them and render as "—" — substituting a confluence score here
                    displayed an unrelated metric under a pillar label. */}
                <Component label="Trend alignment" weight="35%" value={signal.p_trend} />
                <Component label="Order block retest" weight="25%" value={signal.p_order_block} />
                <Component label="Momentum exhaustion" weight="20%" value={signal.p_momentum} />
                <Component label="Volatility expansion" weight="20%" value={signal.p_volatility_expansion} />
              </dl>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface/50 px-4 py-3">
        <Button size="sm" variant="outline" onClick={() => void copyOrder()}>
          <Copy className="size-4" /> Copy order details
        </Button>
        {!trade ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => onDecision("taken")}>
              <Check className="size-4" /> Log as Taken
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecision("skipped")}>
              <X className="size-4" /> Log as Skipped
            </Button>
            {open ? (
              <span className="ml-auto min-w-0 text-xs text-muted-foreground">
                {guide
                  ? "You decide whether to trade. Logging it here only records your choice — it never places an order."
                  : "No-Trade is the default. Nothing here is an instruction to execute."}
              </span>
            ) : null}
          </>
        ) : (
          <>
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
              Scanner outcome:{" "}
              {signal.resolved_outcome === "open"
                ? "still open"
                : `${signal.resolved_outcome} ${Number(signal.resolved_r_multiple ?? 0).toFixed(2)}R`}
            </span>
          </>
        )}
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "long" | "short";
  hint?: string;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="label-xs">{hint ? <InfoLabel hint={hint}>{label}</InfoLabel> : label}</p>
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

function Component({
  label,
  weight,
  value,
}: {
  label: string;
  weight: string;
  value: number | null;
}) {
  const score = value === null ? null : Number(value);
  return (
    <div className="flex items-center gap-2">
      <dt className="min-w-0 flex-1 text-xs text-muted-foreground">
        {label} <span className="num opacity-60">{weight}</span>
      </dt>
      <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-accent" style={{ width: `${Math.min(100, score ?? 0)}%` }} />
      </div>
      <dd className="num w-10 shrink-0 text-right text-xs text-foreground">
        {score === null ? "—" : score.toFixed(0)}
      </dd>
    </div>
  );
}
