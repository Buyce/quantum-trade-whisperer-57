import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Copy, X } from "lucide-react";
import { toast } from "sonner";
import {
  contextOf,
  INSTRUMENT_LABELS,
  maxAcceptableEntry,
  ORDER_TIF_MINUTES,
  type OrderStrategy,
  isCapped,
  SESSION_LABELS,
  targetLadder,
  type SignalRow,
  type TradeRow,
} from "@/lib/db-types";
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

/** Pip size per instrument — used only to phrase live distance in trader units. */
const PIP: Record<string, number> = { EURUSD: 0.0001, GBPAUD: 0.0001, XAUUSD: 0.01 };

export interface EntryDistance {
  state: "awaiting" | "at_entry" | "ran" | "invalidated";
  pips: number;
  r: number;
}

/**
 * Live distance from a pending entry. Pure function of the stored setup and one
 * shared quote — no per-client broker calls, and no output at all when the quote
 * is missing (never an estimated price).
 */
export function entryDistance(signal: SignalRow, mid: number | undefined): EntryDistance | null {
  if (mid === undefined || !Number.isFinite(mid)) return null;
  const risk = Math.abs(Number(signal.entry_price) - Number(signal.stop_loss));
  if (risk <= 0) return null;
  const long = signal.direction === "long";
  const gap = mid - Number(signal.entry_price);
  const r = Math.abs(gap) / risk;
  const pips = Math.abs(gap) / (PIP[signal.instrument] ?? 0.0001);

  const beyondStop = long ? mid <= Number(signal.stop_loss) : mid >= Number(signal.stop_loss);
  if (beyondStop) return { state: "invalidated", pips, r };
  const ranAway = long ? gap > risk * 0.5 : gap < -risk * 0.5;
  if (ranAway) return { state: "ran", pips, r };
  if (r <= 0.1) return { state: "at_entry", pips, r };
  return { state: "awaiting", pips, r };
}

function DistanceChip({ d }: { d: EntryDistance }) {
  // Two phrasings of the same fact: phones get the short one so the chip never
  // overflows the card and clips, desktops keep the fully explained version.
  const short =
    d.state === "invalidated"
      ? "Invalidated"
      : d.state === "ran"
        ? `Ran past entry · ${d.pips.toFixed(1)} pips`
        : d.state === "at_entry"
          ? "At entry — fills now"
          : `Awaiting fill · ${d.pips.toFixed(1)} pips`;
  const full =
    d.state === "invalidated"
      ? "Invalidated — price traded through the stop"
      : d.state === "ran"
        ? `Ran past entry — ${d.pips.toFixed(1)} pips (${d.r.toFixed(2)}R) away`
        : d.state === "at_entry"
          ? "At entry — limit order would fill now"
          : `Awaiting fill — ${d.pips.toFixed(1)} pips (${d.r.toFixed(2)}R) away`;
  return (
    <span
      className={cn(
        "num inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-medium",
        d.state === "invalidated"
          ? "border-short/40 bg-short/10 text-short"
          : d.state === "at_entry"
            ? "border-long/40 bg-long/10 text-long"
            : d.state === "ran"
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border bg-surface text-muted-foreground",
      )}
    >
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </span>
  );
}

export type ExecutionState = "safe" | "beyond" | "invalidated";

export interface ExecutionRead {
  state: ExecutionState;
  /** The slippage ceiling this verdict was measured against. */
  limit: number;
  mid: number;
}

/**
 * Tier 1 order guidance. Compares the shared live mid to the stored slippage
 * ceiling: at or inside it the setup can still be taken now, beyond it the only
 * valid order is a limit back at the entry for the retest (a stop order on the
 * wrong side of price is rejected by MT4/MT5, so it is never suggested).
 */
export function executionRead(signal: SignalRow, mid: number | undefined): ExecutionRead | null {
  if (mid === undefined || !Number.isFinite(mid)) return null;
  const limit = maxAcceptableEntry(signal);
  const long = signal.direction === "long";
  const stop = Number(signal.stop_loss);
  if (long ? mid <= stop : mid >= stop) return { state: "invalidated", limit, mid };
  const beyond = long ? mid > limit : mid < limit;
  return { state: beyond ? "beyond" : "safe", limit, mid };
}

function ExecutionChip({
  read,
  instrument,
  strategy,
}: {
  read: ExecutionRead;
  instrument: string;
  strategy: OrderStrategy;
}) {
  if (read.state === "invalidated") return null;
  const safe = read.state === "safe";
  const shortText = safe
    ? strategy === "strict_retest"
      ? "IN SAFE ZONE — LIMIT AT ENTRY"
      : "SAFE TO ENTER"
    : "BEYOND SAFE LIMIT — USE LIMIT";
  const fullText = safe
    ? strategy === "strict_retest"
      ? `IN SAFE ZONE — PLACE YOUR LIMIT AT ENTRY (ceiling ${price(read.limit, instrument)})`
      : `SAFE TO ENTER — price is inside the ${price(read.limit, instrument)} ceiling`
    : `PRICE BEYOND SAFE LIMIT (${price(read.limit, instrument)}) — PLACE LIMIT ORDER FOR RETEST`;
  return (
    <span
      className={cn(
        "num inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-semibold",
        safe
          ? "animate-pulse border-long/50 bg-long/15 text-long"
          : "animate-pulse border-short/50 bg-short/15 text-short",
      )}
      role="status"
    >
      <span className="sm:hidden">{shortText}</span>
      <span className="hidden sm:inline">{fullText}</span>
    </span>
  );
}

export function SignalCard({
  signal,
  trade,
  onDecision,
  onResult,
  busy,
  quoteMid,
  orderStrategy = "smart_adaptive",
}: {
  signal: SignalRow;
  trade: TradeRow | undefined;
  onDecision: (decision: "taken" | "skipped") => void;
  onResult: (outcome: "win" | "loss" | "breakeven", r: number) => void;
  busy: boolean;
  /** Shared live mid price for this instrument, when available. */
  quoteMid?: number | undefined;
  /** The user's manual order-guidance preference. */
  orderStrategy?: OrderStrategy;
}) {
  const ctx = contextOf(signal);
  const long = signal.direction === "long";
  const conf = Number(signal.confidence_score);
  const { guide } = useGuideMode();
  const orderType = long ? "BUY LIMIT" : "SELL LIMIT";
  const ladder = targetLadder(signal);
  const capped = isCapped(signal);
  const distance = entryDistance(signal, quoteMid);
  const execution = executionRead(signal, quoteMid);
  const ceiling = maxAcceptableEntry(signal);
  // Progressive disclosure: the top tier opens by default because it is the one
  // setup a trader always wants the detail on; everything else starts collapsed.
  const [open, setOpen] = useState(signal.grade === "A+");
  const detailId = `signal-detail-${signal.id}`;

  async function copyOrder() {
    const p = (v: number) => price(v, signal.instrument);
    const text = [
      `${signal.instrument} — ${orderType} (${long ? "LONG" : "SHORT"})`,
      `Entry (limit):        ${p(signal.entry_price)}`,
      `Max acceptable entry: ${p(ceiling)}`,
      `Stop-loss:  ${p(signal.stop_loss)}`,
      ...ladder.map((t) => `${t.label.replace(" · ", " (")}):  ${p(t.price)}`),
      `R:R:        ${Number(signal.rr_ratio).toFixed(2)}${capped ? " (capped by H4 barrier)" : ""}`,
      `Confidence: ${conf.toFixed(1)}%  ·  Grade ${signal.grade}`,
      `If price is beyond ${p(ceiling)}, do NOT enter at market — leave the limit at ${p(signal.entry_price)} for the retest.`,
      `Cancel this order if unfilled within ${ORDER_TIF_MINUTES} minutes (2 candles).`,
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
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-3 text-left hover:bg-surface/60 sm:flex sm:items-center sm:px-4"
      >
        <div className="grid min-w-0 flex-1 gap-2 sm:flex sm:items-center sm:gap-3">
          {/* Identity line: instrument is never allowed to shrink away — it is
              the single most important token on the card. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="num shrink-0 text-lg font-bold leading-none text-foreground sm:text-base">
              {signal.instrument}
            </span>
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
            {/* Always-on: these are pending limit orders, never market entries. */}
            <Badge variant="outline" className="num shrink-0 font-normal">
              {orderType}
            </Badge>
            {capped ? (
              <Badge
                variant="outline"
                className="num shrink-0 border-warning/40 bg-warning/10 font-normal text-warning"
              >
                CAPPED {Number(signal.max_r ?? signal.rr_ratio).toFixed(2)}R
              </Badge>
            ) : null}
            {execution ? (
              <ExecutionChip read={execution} instrument={signal.instrument} strategy={orderStrategy} />
            ) : null}
            {distance ? <DistanceChip d={distance} /> : null}
            <Badge variant="outline" className="num shrink-0 font-normal text-muted-foreground">
              TIF {ORDER_TIF_MINUTES}m
            </Badge>
            {trade ? (
              <Badge
                variant={trade.user_decision === "taken" ? "default" : "secondary"}
                className="num shrink-0 sm:hidden"
              >
                {trade.user_decision === "taken" ? "TAKEN" : "SKIPPED"}
              </Badge>
            ) : null}
          </div>
          {/* Key numbers: a labelled 2x2 grid on phones so they read as data,
              collapsing back to the single inline row from sm up. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground sm:ml-auto sm:flex sm:min-w-0 sm:flex-wrap sm:items-center sm:gap-y-1">
            <span className="num flex min-w-0 flex-col sm:block">
              <span className="label-xs sm:hidden">R:R</span>
              <span className="hidden sm:inline">R:R </span>
              <span className="text-sm font-semibold text-foreground sm:text-xs">
                {Number(signal.rr_ratio).toFixed(2)}
              </span>
            </span>
            <span className="num flex min-w-0 flex-col sm:block">
              <span className="label-xs sm:hidden">Confidence</span>
              <span className="hidden sm:inline">Conf </span>
              <span className="text-sm font-semibold text-primary sm:text-xs">{conf.toFixed(0)}%</span>
            </span>
            <span className="num flex min-w-0 flex-col sm:block">
              <span className="label-xs sm:hidden">Entry (limit)</span>
              <span className="hidden sm:inline">Entry </span>
              <span className="text-sm font-semibold text-foreground sm:text-xs">
                {price(signal.entry_price, signal.instrument)}
              </span>
            </span>
            <span className="num flex min-w-0 flex-col sm:block">
              <span className="label-xs sm:hidden">Detected</span>
              <span className="text-sm font-semibold text-foreground sm:text-xs sm:font-normal sm:text-muted-foreground">
                {age(signal.detected_at)} ago
              </span>
            </span>
            {trade ? (
              <Badge
                variant={trade.user_decision === "taken" ? "default" : "secondary"}
                className="num hidden sm:inline-flex"
              >
                {trade.user_decision === "taken" ? "TAKEN" : "SKIPPED"}
              </Badge>
            ) : null}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "mt-0.5 size-5 shrink-0 text-muted-foreground transition-transform sm:mt-0 sm:size-4",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div id={detailId} className="border-t border-border">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
            <span>{INSTRUMENT_LABELS[signal.instrument] ?? ""}</span>
            {guide ? (
              <span>
                Place this as a pending {orderType.toLowerCase()} and wait for the fill. Anything worse
                than {price(ceiling, signal.instrument)} is a chase — leave the limit where it is.
              </span>
            ) : null}
            <Badge variant="outline" className="num font-normal">
              <InfoLabel hint={`Time-in-force. If the market has not come back to your entry within ${ORDER_TIF_MINUTES} minutes (2 M15 candles), the structure that was graded is gone. Cancelling the un-filled order protects your capital from a stale setup.`}>
                Cancel un-filled orders in {ORDER_TIF_MINUTES} minutes (2 candles)
              </InfoLabel>
            </Badge>
            {ctx ? (
              <Badge variant="outline" className="num font-normal">
                {SESSION_LABELS[ctx.trading_session] ?? ctx.trading_session}
              </Badge>
            ) : null}
            <span className="num sm:ml-auto">
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
              label="Entry (limit)"
              hint="The price to place your pending limit order at — the Point C structural level."
              value={price(signal.entry_price, signal.instrument)}
            />
            <Metric
              label="Max acceptable entry"
              hint="The worst price at which taking this setup at market still keeps the planned payoff intact. Beyond it, only a limit order back at the entry makes sense."
              value={price(ceiling, signal.instrument)}
              tone="long"
            />
            <Metric
              label="Stop-loss"
              hint="Where the plan is wrong. Place this order with the trade: it caps the loss at 1R."
              value={price(signal.stop_loss, signal.instrument)}
              tone="short"
            />
            {/* Targets are rendered from what the structure can actually reach.
                A target the H4 barrier blocks is omitted, never faked as 1:3. */}
            {ladder.map((t, i) => (
              <Metric
                key={t.label}
                label={t.label}
                hint={`Take-profit ${i + 1} — closing here returns ${t.r.toFixed(2)}x what you risked.`}
                value={price(t.price, signal.instrument)}
                tone="long"
              />
            ))}
            <Metric
              label="R:R"
              hint="Risk-to-reward of the final target. This is the true reachable payoff, not a default 1:3."
              value={`${Number(signal.rr_ratio).toFixed(2)}`}
            />

          </div>

          <div className="grid gap-5 border-t border-border px-3 py-4 sm:px-4 lg:grid-cols-[minmax(0,1fr)_320px]">
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

      <div className="border-t border-border bg-surface/50 px-3 py-3 sm:px-4">
        {!trade ? (
          <div className="space-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0">
            {/* Phones: two full-height rows of tap targets. sm+: the original inline row. */}
            <div className="grid grid-cols-2 gap-2 sm:contents">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onDecision("taken")}
                className="h-10 w-full sm:h-8 sm:w-auto"
              >
                <Check className="size-4" /> Log as Taken
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onDecision("skipped")}
                className="h-10 w-full sm:h-8 sm:w-auto"
              >
                <X className="size-4" /> Log as Skipped
              </Button>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyOrder()}
              className="h-10 w-full sm:order-first sm:h-8 sm:w-auto"
            >
              <Copy className="size-4" /> Copy order details
            </Button>
            {open ? (
              <span className="block text-xs leading-snug text-muted-foreground sm:ml-auto sm:min-w-0">
                {guide
                  ? "You decide whether to trade. Logging it here only records your choice — it never places an order."
                  : "No-Trade is the default. Nothing here is an instruction to execute."}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyOrder()}
              className="h-10 w-full sm:h-8 sm:w-auto"
            >
              <Copy className="size-4" /> Copy order details
            </Button>
            {trade.user_decision === "taken" && trade.outcome === "open" ? (
              <div className="space-y-1.5 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
                <span className="label-xs block">Close at</span>
                <div className="grid grid-cols-5 gap-1.5 sm:contents">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onResult("win", 1)}
                    className="h-10 px-0 sm:h-8 sm:px-3"
                  >
                    +1R
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onResult("win", 2)}
                    className="h-10 px-0 sm:h-8 sm:px-3"
                  >
                    +2R
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onResult("win", 3)}
                    className="h-10 px-0 sm:h-8 sm:px-3"
                  >
                    +3R
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onResult("breakeven", 0)}
                    className="h-10 px-0 sm:h-8 sm:px-3"
                  >
                    BE
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onResult("loss", -1)}
                    className="h-10 px-0 text-short sm:h-8 sm:px-3"
                  >
                    −1R
                  </Button>
                </div>
              </div>
            ) : trade.user_decision === "taken" ? (
              <span
                className={cn(
                  "num block text-sm font-semibold",
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
            <span className="num block text-xs text-muted-foreground sm:ml-auto">
              Scanner outcome:{" "}
              {signal.resolved_outcome === "open"
                ? "still open"
                : `${signal.resolved_outcome} ${Number(signal.resolved_r_multiple ?? 0).toFixed(2)}R`}
            </span>
          </div>
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
    <div className="min-w-0 bg-card px-3 py-3.5 sm:px-4 sm:py-3">
      <p className="label-xs break-words">{hint ? <InfoLabel hint={hint}>{label}</InfoLabel> : label}</p>
      <p
        className={cn(
          "num mt-1 break-words text-base font-semibold sm:text-sm",
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
