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
import { formatJournalR, journalRView } from "@/lib/journal/display";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoLabel, useGuideMode } from "@/components/GuideMode";
import { MIN_N_FILL, MIN_N_TIER3, MIN_N_WIN, tierLabel } from "@/lib/learning/regime";
import { explainRegime, PRIOR_STRENGTH } from "@/lib/learning/explain";
import { regimeStatsQuery } from "@/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { money } from "@/lib/risk";
import { resolveSizingForSetup } from "@/lib/sizing.functions";

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

/**
 * Read-only Intelligence Panel. Shows the Bayesian priors the scanner recorded
 * from shadow telemetry, always alongside the sample size behind them and the
 * regime tier that produced them.
 *
 * ZERO-HALLUCINATION: renders nothing at all when the signal has no priors.
 * Each metric carries its own gate status — the fill rate can be active while
 * the win rate is still learning — and neither ever places, blocks or reprices
 * a trade.
 */
function IntelligencePanel({ signal }: { signal: SignalRow }) {
  const pFill = signal.p_fill_prior;
  const pWin = signal.p_win_prior;
  // Prefer the truthfully named column; fall back to the legacy one, which holds
  // the identical quantity for rows published before the rename.
  const pJoint = signal.p_joint_prior ?? signal.ev_prior;
  const n = signal.prior_sample_n ?? 0;
  const filledN = signal.prior_filled_n;
  const tier = signal.prior_tier;
  if (pFill == null || pWin == null) return null;

  // Gates are evaluated against their own denominators: resolved samples for
  // fill, filled samples for win. A signal published before the filled count
  // was recorded reports the win gate as unknown rather than guessing.
  const fillGate = n >= MIN_N_FILL;
  const winGate = filledN != null && filledN >= MIN_N_WIN;
  const pct = (v: number) => `${(Number(v) * 100).toFixed(1)}%`;

  return (
    <div className="border-t border-border px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="label-xs">
          <InfoLabel hint="Historical rates measured by replaying past setups from this same regime against real candles. Smoothed toward the wider average when the sample is small, so a thin bucket can never show a wild number.">
            Intelligence
          </InfoLabel>
        </p>
        <span className="num text-xs text-muted-foreground">
          {tier == null ? `sample n = ${n}` : `${tierLabel(tier)} · n = ${n}`}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3">
        <div className="min-w-0">
          <dt className="label-xs">Fill rate</dt>
          <dd className="num text-base font-semibold text-foreground">{pct(pFill)}</dd>
          <p className={cn("mt-0.5 text-[11px]", fillGate ? "text-success" : "text-muted-foreground")}>
            {fillGate ? "Active" : `Learning ${n}/${MIN_N_FILL}`}
          </p>
        </div>
        <div className="min-w-0">
          <dt className="label-xs">Win if filled</dt>
          <dd className="num text-base font-semibold text-foreground">{pct(pWin)}</dd>
          <p className={cn("mt-0.5 text-[11px]", winGate ? "text-success" : "text-muted-foreground")}>
            {filledN == null
              ? "Sample not recorded"
              : winGate
                ? "Active"
                : `Learning ${filledN}/${MIN_N_WIN} filled`}
          </p>
        </div>
        <div className="min-w-0">
          <dt className="label-xs">
            <InfoLabel hint="P(fill) x P(TP1+ | filled) — a model estimate of the chance this setup both fills and reaches its first target. It is a probability, not a return and not an expected R.">
              Est. joint win prob.
            </InfoLabel>
          </dt>
          <dd className="num text-base font-semibold text-foreground">
            {pJoint == null ? "—" : pct(pJoint)}
          </dd>
          <p className="mt-0.5 text-[11px] text-muted-foreground">fill x win — probability</p>
        </div>
      </dl>

      <p className="mt-3 text-xs leading-snug text-muted-foreground">
        {fillGate
          ? "Fill rate has cleared its sample threshold and is shown as a measured rate. It still does not place, block or reprice trades — grading, alerts and the daily limit ignore these numbers entirely."
          : "Shown for observation only: grading, alerts and the daily limit ignore these numbers entirely."}
      </p>

      <ModelExplain signal={signal} />
    </div>
  );
}


const PCT = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const SIGNED = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`);

/**
 * Model-explain drawer: shows WHICH regimes and features drive this signal's
 * win/fill estimate, and how much of the estimate is its own evidence versus
 * borrowed from a broader regime.
 *
 * HONESTY: the engine is hierarchical Beta-Binomial shrinkage, not a weighted
 * model, so this reports the real shrinkage ladder and measured per-feature
 * differences from the replay dataset. No fabricated importances, and every
 * figure is shown with the sample size behind it.
 */
function ModelExplain({ signal }: { signal: SignalRow }) {
  const [open, setOpen] = useState(false);
  const ctx = contextOf(signal);
  const { data: rows } = useQuery({ ...regimeStatsQuery(), enabled: open });

  const explanation =
    open && rows && ctx
      ? explainRegime(rows, {
          instrument: signal.instrument,
          direction: signal.direction,
          session: ctx.trading_session,
          volatilityIndex: ctx.volatility_index ?? null,
        })
      : null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        {open ? "Hide" : "Why these rates?"}
      </button>

      {open ? (
        !ctx ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No market context was recorded for this setup, so the regime it belongs to cannot be
            reconstructed.
          </p>
        ) : !rows ? (
          <p className="mt-2 text-xs text-muted-foreground">Loading regime statistics…</p>
        ) : !explanation ? (
          <p className="mt-2 text-xs text-muted-foreground">
            The learning engine has not produced statistics yet — nothing to explain.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            <div>
              <p className="label-xs">Regime ladder</p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                The estimate starts from the widest pool and is pulled toward this setup&apos;s own
                bucket only as fast as that bucket earns samples (prior strength k ={" "}
                {PRIOR_STRENGTH}).
              </p>
              {explanation.tier3SkippedN != null ? (
                <p className="mt-2 rounded border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs leading-snug text-foreground">
                  This exact regime has only {explanation.tier3SkippedN} resolved{" "}
                  {explanation.tier3SkippedN === 1 ? "sample" : "samples"} — below the {MIN_N_TIER3}
                  -sample floor — so the estimate falls back to the broader tier below rather than
                  presenting a thin bucket as a specific read.
                </p>
              ) : null}
              <ul className="mt-2 space-y-2">
                {explanation.ladder.map((s) => (
                  <li
                    key={s.tier}
                    className={cn(
                      "rounded border px-2.5 py-2",
                      s.matched ? "border-primary/50 bg-primary/5" : "border-border/60",
                    )}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <span className="text-xs font-medium text-foreground">
                        {s.label}
                        {s.matched ? " · used" : null}
                      </span>
                      <span className="num text-[11px] text-muted-foreground">
                        n = {s.nTotal} · filled {s.nFilled} · wins {s.wins}
                      </span>
                    </div>
                    <div className="num mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>
                        fill {PCT(s.pFillRaw)} raw → {PCT(s.pFillShrunk)} smoothed
                      </span>
                      <span>
                        win {PCT(s.pWinRaw)} raw → {PCT(s.pWinShrunk)} smoothed
                      </span>
                      <span>own evidence {Math.round(s.ownWeightWin * 100)}% of win estimate</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="label-xs">Feature influence (measured, not modelled)</p>
              {explanation.features.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No feature slice has any resolved samples yet.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border/60">
                  {explanation.features.map((f) => (
                    <li key={f.feature} className="py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="text-xs font-medium text-foreground">
                          {f.feature}: {f.value}
                        </span>
                        <span className="num text-[11px] text-muted-foreground">
                          win {SIGNED(f.deltaWinPp)} · fill {SIGNED(f.deltaFillPp)}
                        </span>
                      </div>
                      <p className="num mt-0.5 text-[11px] text-muted-foreground">
                        vs {f.baseline} · n = {f.nTotal}, filled {f.nFilled}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="text-[11px] leading-snug text-muted-foreground">
              Differences are raw, unsmoothed percentage points from the shadow replay dataset —
              associations, not proven causes, and thin slices move easily. This estimate currently
              leans on{" "}
              {explanation.leansOn === "own-bucket"
                ? "its own bucket's evidence"
                : "broader parent regimes"}
              . Volatility tercile:{" "}
              {explanation.bucket === "unknown" ? "not classified" : explanation.bucket}.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}


/**
 * Per-user position sizing, resolved by the shared authenticated sizing service.
 *
 * The browser no longer computes sizing: the server loads the broker contract
 * specification, decides spec/quote freshness, runs the dual model and returns
 * the authoritative answer plus its provenance. UI and agents therefore always
 * quote the same number and the same caveats.
 *
 * ZERO-HALLUCINATION: when equity is unset, the FX conversion rate is missing or
 * the quote is stale, this renders the reason instead of a lot size.
 */
function RiskPanel({ signal }: { signal: SignalRow }) {
  const ladder = targetLadder(signal);
  const finalR = ladder.length ? ladder[ladder.length - 1]!.r : (signal.max_r ?? null);
  const resolve = useServerFn(resolveSizingForSetup);
  const sizing = useQuery({
    queryKey: ["sizing", signal.id],
    staleTime: 30_000,
    queryFn: () =>
      resolve({
        data: {
          instrument: signal.instrument,
          entryPrice: Number(signal.entry_price),
          stopLoss: Number(signal.stop_loss),
          finalTargetR: finalR,
          signalId: signal.id,
        },
      }),
  });

  if (sizing.isLoading) {
    return (
      <div className="border-t border-border px-3 py-4 sm:px-4">
        <p className="label-xs">Your position size</p>
        <p className="mt-2 text-sm text-muted-foreground">Sizing this setup…</p>
      </div>
    );
  }

  const result = sizing.data;
  if (!result || sizing.isError) {
    return (
      <div className="border-t border-border px-3 py-4 sm:px-4">
        <p className="label-xs">Your position size</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Position size could not be calculated right now. Nothing is estimated in its place.
        </p>
      </div>
    );
  }

  if (!result.available) {
    return (
      <div className="border-t border-border px-3 py-4 sm:px-4">
        <p className="label-xs">Your position size</p>
        <p className="mt-2 text-sm text-muted-foreground">{result.explanation}</p>
        <ProvenanceLine provenance={result.provenance} />
        <AdvisoryLine advisory={result.advisory} />
      </div>
    );
  }

  const cur = result.currency;
  const profile = result.profile;

  return (
    <div className="border-t border-border px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="label-xs">
          <InfoLabel hint="Calculated on the server from your own risk profile in Settings: your entered balance and risk-per-trade decide the lot size, this setup's stop distance decides how much one lot can lose. Rounded down to a tradable lot step, so the money at risk is never more than your limit.">
            Your position size
          </InfoLabel>
        </p>
        <span className="num text-xs text-muted-foreground">
          {profile.riskPerTradePercent}% of {money(profile.accountEquity, cur)} · 1:
          {profile.leverage}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="label-xs">Lots</dt>
          <dd
            className={cn(
              "num text-base font-semibold",
              result.belowMinimumLot ? "text-short" : "text-foreground",
            )}
          >
            {result.lots.toFixed(2)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label-xs">Risk at stop</dt>
          <dd className="num text-base font-semibold text-short">
            {money(result.riskAmount, cur)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label-xs">
            {result.finalTargetR === null
              ? "Reward at target"
              : `Reward at ${result.finalTargetR.toFixed(2)}R`}
          </dt>
          <dd className="num text-base font-semibold text-long">
            {result.rewardAtFinalTarget === null ? "—" : money(result.rewardAtFinalTarget, cur)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label-xs">Margin (est.)</dt>
          <dd
            className={cn(
              "num text-base font-semibold",
              result.exceedsMargin ? "text-short" : "text-foreground",
            )}
          >
            {money(result.marginEstimate, cur)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="num">Stop distance: {result.stopPercent.toFixed(2)}% of entry</span>
        <span className="num">Per lot: {money(result.riskPerLot, cur)}</span>
        <span className="num">Position value: {money(result.notional, cur)}</span>
        <span className="num">
          Est. margin: {result.marginPercentOfEquity.toFixed(1)}% of equity (notional ÷ leverage,
          not your broker's figure)
        </span>
        {result.quoteCurrency !== cur ? (
          <span className="num">
            Converted from {result.quoteCurrency} at {result.conversionRate.toFixed(5)}
          </span>
        ) : null}
        {result.minStopDistance !== null ? (
          <span className="num">
            Broker minimum stop distance: {result.minStopDistance.toFixed(5)}
          </span>
        ) : null}
      </div>

      {result.guardrails.length ? (
        <ul className="mt-3 space-y-1.5">
          {result.guardrails.map((w) => (
            <li
              key={w}
              className="rounded-sm border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs leading-snug text-warning"
            >
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <ProvenanceLine provenance={result.provenance} />
      <AdvisoryLine advisory={result.advisory} />

      <p className="mt-3 text-xs leading-snug text-muted-foreground">
        Sizing guidance from your saved settings, not financial advice. Confirm the lot size and
        margin in your own platform before placing the order.
      </p>
    </div>
  );
}

/** Where the numbers came from — never implied, always stated. */
function ProvenanceLine({
  provenance,
}: {
  provenance: {
    specSource: string;
    specAsOf: string | null;
    specStale: boolean;
    quoteAsOf: string | null;
    quoteStale: boolean;
    conversionRoute: string;
    equityAsOf: string | null;
    authoritativeModel: number;
    shadowAvailable: boolean;
  };
}) {
  const specLabel =
    provenance.specSource === "broker"
      ? `broker contract spec${provenance.specAsOf ? ` · ${new Date(provenance.specAsOf).toLocaleString()}` : ""}`
      : "documented contract table (not broker-confirmed)";
  return (
    <p className="mt-3 text-xs leading-snug text-muted-foreground">
      Contract data: {specLabel}
      {provenance.specStale ? " · out of date" : ""}. Conversion: {provenance.conversionRoute}
      {provenance.quoteAsOf ? ` · quoted ${new Date(provenance.quoteAsOf).toLocaleTimeString()}` : ""}
      . Balance: entered by you
      {provenance.equityAsOf
        ? `, last updated ${new Date(provenance.equityAsOf).toLocaleDateString()}`
        : " (date unknown)"}
      , not broker-confirmed.
    </p>
  );
}

/** Advisory exposure from the user's own journal — never broker account state. */
function AdvisoryLine({
  advisory,
}: {
  advisory: {
    openPositions: number;
    pendingPositions: number;
    openRiskR: number;
    openRiskMoney: number | null;
    realizedLossTodayR: number;
    realizedLossTodayMoney: number | null;
    currency: string;
    byCurrency: { currency: string; positions: number; share: number }[];
  } | null;
}) {
  if (!advisory) return null;
  if (
    advisory.openPositions === 0 &&
    advisory.pendingPositions === 0 &&
    advisory.realizedLossTodayR === 0
  ) {
    return null;
  }
  const cur = advisory.currency;
  return (
    <div className="mt-3 rounded-sm border border-border bg-surface/50 px-2 py-1.5 text-xs leading-snug text-muted-foreground">
      <p className="font-medium text-foreground/80">Exposure based on trades you logged</p>
      <p className="num mt-1">
        Open: {advisory.openPositions} ({advisory.openRiskR.toFixed(2)}R
        {advisory.openRiskMoney === null ? "" : ` ≈ ${money(advisory.openRiskMoney, cur)}`}) ·
        Pending fills: {advisory.pendingPositions} · Realized loss today:{" "}
        {advisory.realizedLossTodayR.toFixed(2)}R
        {advisory.realizedLossTodayMoney === null
          ? ""
          : ` ≈ ${money(advisory.realizedLossTodayMoney, cur)}`}
      </p>
      {advisory.byCurrency.length ? (
        <p className="num mt-1">
          Concentration:{" "}
          {advisory.byCurrency
            .map((c) => `${c.currency} ${(c.share * 100).toFixed(0)}%`)
            .join(" · ")}
        </p>
      ) : null}
      <p className="mt-1">
        Advisory only, from your own journal — not your broker account. It never blocks a size.
      </p>
    </div>
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
  showRisk = true,
}: {
  signal: SignalRow;
  trade: TradeRow | undefined;
  onDecision: (decision: "taken" | "skipped") => void;
  /**
   * Outcome only. The R multiple is never taken from a button press — it is
   * derived server-side from the real entry/exit prices logged in Trade History.
   */
  onResult: (outcome: "win" | "loss" | "breakeven") => void;
  busy: boolean;
  /** Shared live mid price for this instrument, when available. */
  quoteMid?: number | undefined;
  /** The user's manual order-guidance preference. */
  orderStrategy?: OrderStrategy;
  /**
   * Render the sizing panel. Sizing itself is resolved server-side by the shared
   * sizing service, so no risk profile or FX rate is passed through the browser.
   */
  showRisk?: boolean;
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
      `Confluence score: ${conf.toFixed(1)}%  ·  Grade ${signal.grade}`,
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
              <span className="label-xs sm:hidden">Confluence</span>
              <span className="hidden sm:inline">Confl </span>
              <span className="text-sm font-semibold text-primary sm:text-xs">{conf.toFixed(0)}%</span>
            </span>
            {/* The joint win probability only appears once its sample gate is clear,
                so the summary row never implies a measured rate that does not exist. */}
            {(signal.p_joint_prior ?? signal.ev_prior) != null &&
            (signal.prior_sample_n ?? 0) >= MIN_N_FILL ? (
              <span className="num flex min-w-0 flex-col sm:block">
                <span className="label-xs sm:hidden">Win prob.</span>
                <span className="hidden sm:inline">WIN-P </span>
                <span className="text-sm font-semibold text-foreground sm:text-xs">
                  {(Number(signal.p_joint_prior ?? signal.ev_prior) * 100).toFixed(1)}%
                </span>
              </span>
            ) : null}

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
                  <InfoLabel hint="Weighted confluence of the four pillars, discounted by the planned payoff. It is a rule-match quality score, not a probability of profit or a win rate.">
                    Confluence score
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
                <Component label="Displacement-origin zone" weight="25%" value={signal.p_order_block} />
                <Component label="Momentum exhaustion" weight="20%" value={signal.p_momentum} />
                <Component label="Volatility expansion" weight="20%" value={signal.p_volatility_expansion} />
              </dl>
            </div>
          </div>

          {showRisk ? <RiskPanel signal={signal} /> : null}

          <IntelligencePanel signal={signal} />
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
                <span
                  className="label-xs block cursor-help"
                  title="Records the outcome only. Add your real entry and exit price in Trade History and the R multiple is calculated from them."
                >
                  Closed as
                </span>
                <div className="grid grid-cols-3 gap-1.5 sm:contents">
                  {(["win", "breakeven", "loss"] as const).map((o) => (
                    <Button
                      key={o}
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onResult(o)}
                      className={cn(
                        "h-10 px-0 sm:h-8 sm:px-3",
                        o === "loss" && "text-short",
                      )}
                    >
                      {o === "win" ? "Win" : o === "breakeven" ? "Break-even" : "Loss"}
                    </Button>
                  ))}
                </div>
              </div>
            ) : trade.user_decision === "taken" ? (
              (() => {
                // Explicit basis, explicit unavailability: never a false 0.00R.
                const view = journalRView(trade, "actual_risk");
                return (
                  <span
                    title={view.reason ?? view.label}
                    className={cn(
                      "num block text-sm font-semibold",
                      (view.value ?? 0) > 0
                        ? "text-long"
                        : (view.value ?? 0) < 0
                          ? "text-short"
                          : "text-muted-foreground",
                    )}
                  >
                    {trade.outcome.toUpperCase()} · {formatJournalR(view)}
                    {view.provenance === "legacy" ? " (legacy)" : ""}
                  </span>
                );
              })()
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
