import { ArrowDownRight, ArrowUpRight, Check, Copy, X } from "lucide-react";
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
  const { guide } = useGuideMode();
  const orderType = long ? "BUY LIMIT" : "SELL LIMIT";

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
          {guide ? `${orderType} (${long ? "LONG" : "SHORT"})` : long ? "LONG" : "SHORT"}
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
            <span className="num text-xs text-muted-foreground">
              {signal.pillars_passed ?? "—"}/4 passed
            </span>
          </div>
          <dl className="mt-2 space-y-1.5">
            <Component
              label="Trend alignment"
              weight="35%"
              value={Number(signal.p_trend ?? signal.c_alignment)}
            />
            <Component
              label="Order block retest"
              weight="25%"
              value={Number(signal.p_order_block ?? signal.c_symmetry)}
            />
            <Component
              label="Momentum exhaustion"
              weight="20%"
              value={Number(signal.p_momentum ?? signal.c_rr)}
            />
            <Component
              label="Volatility expansion"
              weight="20%"
              value={Number(signal.p_volatility_expansion ?? signal.c_volatility)}
            />
          </dl>
        </div>

      </div>

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
            <span className="ml-auto text-xs text-muted-foreground">
              {guide
                ? "You decide whether to trade. Logging it here only records your choice — it never places an order."
                : "No-Trade is the default. Nothing here is an instruction to execute."}
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
