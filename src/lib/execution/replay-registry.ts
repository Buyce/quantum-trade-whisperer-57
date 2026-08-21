/**
 * Immutable replay-version provenance.
 *
 * A *model* version says how a trade plan was produced. A *replay* version says
 * how that plan's outcome was adjudicated from candles. The two are independent
 * dimensions, and so is the execution policy applied on top.
 *
 * Replay V1 is the frozen production labeller — its semantics are a
 * characterisation of what already ran, never a specification to change. Replay
 * V2 is the corrected research labeller. Once a single Replay-V2 row exists,
 * changing any rule below requires Replay V3, not an edit here; a blocking test
 * pins each hash.
 */
import { stableHash } from "@/lib/scanner/v2/manifest";
import { ORDER_TIF_MINUTES, SIGNAL_MAX_AGE_HOURS } from "@/lib/scanner/types";

export const REPLAY_V1_VERSION = 1 as const;
export const REPLAY_V2_VERSION = 2 as const;

export const REPLAY_V1_LABEL = "legacy_m15_optimistic" as const;
export const REPLAY_V2_LABEL = "m15_fail_closed_actual_risk" as const;

/** The only execution policy Replay V2 supports in this release. */
export const EXECUTION_POLICY_LEGACY = "legacy_best_target_touched" as const;
export const EXECUTION_POLICY_V2 = "single_exit_first_target" as const;

/**
 * Replay V1 semantics — a description of the frozen engine, byte-for-byte the
 * behaviour pinned by the V1_CHARACTERIZATION suite.
 */
export const REPLAY_V1_SEMANTICS = {
  tif: {
    minutes: ORDER_TIF_MINUTES,
    rule: "the fill test runs BEFORE the deadline test, so a touch after detected_at + TIF still fills",
  },
  detectionBar: "the forming detection bar is replayed on a fresh run",
  risk: "R is measured against the PLANNED risk (|entry - stop|), even after a gap fill",
  stop: "any stop touch resolves as exactly -1R; a bar opening beyond the stop is still priced at the stop",
  ambiguity: "within one bar the stop is assumed to precede any target (no counter recorded)",
  target: "the deepest target touched in a bar is credited (best_target_touched)",
  verticalBarrier: { hours: SIGNAL_MAX_AGE_HOURS, rule: "mark to the barrier candle's close" },
  excursions: "MFE/MAE include the whole fill bar and use the planned risk denominator",
  executionPolicy: EXECUTION_POLICY_LEGACY,
  costs: "no cost model: realized_r is gross by construction and net_r is not computed",
} as const;

/**
 * Replay V2 semantics — every locked rule, including the 5F intrabar-causality
 * corrections and the 5G data-source and chronology locks.
 */
export const REPLAY_V2_SEMANTICS = {
  tif: {
    minutes: ORDER_TIF_MINUTES,
    rule: "a bar may fill only when its whole interval lies inside the live-order window: bar_open + 15m <= detected_at + TIF",
    spanningBar: "a bar straddling the deadline sets fill_ambiguous_tif and fails closed (no fill)",
  },
  detectionBar: "unchanged from V1 — the forming detection bar is replayed on a fresh run",
  risk: {
    denominator: "risk_price_actual = |fill_price - stop_loss|",
    appliesTo: ["gross_r", "mfe_r", "mae_r", "target R recompute", "vertical mark-to-market"],
  },
  fill: {
    limitSemantics: "favorable gap-through fills at the bar open; adverse fills are never invented",
    invalidGap:
      "a bar whose open is at/through the stop while the order still works resolves as gap_beyond_stop (NULL label, NULL gross_r)",
  },
  stopGap: {
    ordinary: "a stop touch on a bar that did not open beyond the stop is exactly -1R",
    gapThrough:
      "a later bar opening beyond the stop exits at that bar's OPEN, sets stop_gap_through and may be worse than -1R",
  },
  targetGap: "a bar opening favorably beyond a target credits the target price, never the open",
  ambiguity: {
    sameBarStopAndTarget:
      "stop wins, ambiguous_bars += 1, adjudication = m15_conservative_fallback",
    chronologyFields:
      "tp1_before_stop and stop_before_tp1 stay NULL whenever the order is unknowable; they are populated only when the two events fall in different bars",
  },
  fillBarCausality: {
    ordinaryIntrabarFill:
      "a target touched in the fill bar is NOT credited: the bar is marked conservative, the trade stays open and target adjudication resumes on the next candle",
    ordinaryIntrabarFillAnalytics:
      "first_target_touched / max_target_touched are not set from that bar; the raw touch is recorded in ambiguous_bar_target_touch as an unproven post-entry touch",
    gapAtOpenFill:
      "a gap-at-open fill existed for the whole bar, so same-bar barrier evaluation and target analytics proceed normally",
    excursions:
      "an ordinary intrabar fill bar contributes neither MFE nor MAE (fill_bar_excursion_ambiguous = true); a gap-at-open fill bar does",
  },
  verticalBarrier: {
    hours: SIGNAL_MAX_AGE_HOURS,
    rule: "mark to the barrier candle's close using risk_price_actual",
  },
  dataQualityOutcomes: {
    invalid_plan: "non-finite/zero risk, inverted stop or targets on the wrong side",
    gap_beyond_stop: "entry-side gap that opened at/through the stop",
    handling: "NULL ml_target_label and NULL gross_r; excluded from every fill/win denominator",
  },
  executionPolicy: {
    policy: EXECUTION_POLICY_V2,
    realizedExit: "execution ends at the first target (TP1)",
    postExitAnalytics:
      "max_target_touched beyond TP1 is subsequent market-path analytics only and may never feed gross_r, labels, win rate or learning",
  },
  candleSource:
    "reuses the M15 array already fetched by the hourly production resolver for that instrument; Replay V2 issues no provider request of its own",
  scheduling:
    "production Replay-V1 rows are resolved first (model 1 may consume the whole existing row budget, then model 2, then model 3); Replay-V2 gets a separate bounded slice from the same candles",
  costs: "gross_r only; net_r stays NULL until a documented broker cost schedule exists",
  fillTime: {
    resolution: "m15",
    meaning: "fill_bar_time is a bar-open timestamp, never a broker execution time",
  },
} as const;

export const REPLAY_V1_CODE_HASH = stableHash(REPLAY_V1_SEMANTICS);
export const REPLAY_V2_CODE_HASH = stableHash(REPLAY_V2_SEMANTICS);
