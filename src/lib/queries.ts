import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ACTIVE_MODEL_VERSION } from "./versioning";
import type { RegimeStatRow } from "./learning/regime";
import type { ScannerSettingsRow, SignalRow, TradeHistoryRow, TradeRow } from "./db-types";
import { R_MATH_VERSION } from "./journal/r-math";
import { fetchDayFrame, type FrameClient } from "./delivery/day-frame";
import type { EligibilitySignal } from "./delivery/eligibility";
import {
  buildJournalSnapshot,
  planDecisionWrite,
  type DecisionResult,
  type SignalSnapshotSource,
} from "./journal/decision";


const SIGNAL_COLUMNS =
  "id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, tp1_r, tp2_r, tp3_r, max_r, max_acceptable_entry, structure_key, atr, rr_ratio, confidence_score, c_alignment, c_rr, c_symmetry, c_volatility, pattern_symmetry, p_trend, p_order_block, p_momentum, p_volatility_expansion, pillars_passed, h4_bias, h1_bias, m15_bias, qualitative_breakdown, status, resolved_outcome, resolved_r_multiple, expired_at, p_fill_prior, p_win_prior, ev_prior, p_joint_prior, prior_sample_n, prior_filled_n, prior_tier, market_context(trading_session, volatility_index, time_of_day, day_of_week)";

/**
 * ZERO-HALLUCINATION CONTRACT: this fetcher returns exactly what the live
 * MetaApi scanner pipeline wrote to the database — nothing more. An empty array
 * is a valid, meaningful result ("No Trade" / Capital Preservation Mode) and
 * MUST be surfaced as such. Never add mock rows, sample setups, demo fixtures,
 * or a fallback generator here or in any consumer of this query.
 */
export function signalsQuery(limit = 400) {
  return queryOptions({
    queryKey: ["signals", limit],
    queryFn: async (): Promise<SignalRow[]> => {
      const { data, error } = await supabase
        .from("scanned_signals" as never)
        .select(SIGNAL_COLUMNS)
        .order("detected_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      // No placeholder fallback: absence of signals is real information.
      return (data ?? []) as unknown as SignalRow[];
    },
  });
}

/**
 * The COMPLETE UTC-day eligibility frame — the daily-cap authority.
 *
 * `signalsQuery` above is a display window and must never decide cap membership:
 * on a >400-signal day it truncates and the feed would disagree with the alert
 * fan-out. This query pages to completion through the same `fetchDayFrame`
 * helper the server uses, so both sides compute the cap from identical input.
 */
export function dayFrameQuery() {
  return queryOptions({
    queryKey: ["signal-day-frame"],
    queryFn: async (): Promise<EligibilitySignal[]> =>
      fetchDayFrame(supabase as unknown as FrameClient),
  });
}

/** Bounded on purpose: an unlimited personal history grows without ceiling. */
const TRADE_PAGE_SIZE = 500;

export function myTradesQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["my-trades", userId],
    enabled: !!userId,
    queryFn: async (): Promise<TradeRow[]> => {
      const { data, error } = await supabase
        .from("executed_trades" as never)
        .select(
          "id, user_id, signal_id, user_decision, outcome, realized_r_multiple, actual_entry_price, actual_exit_price, derived_r, price_source, price_source_client, price_recorded_at, decision_source, decision_source_client, notes, created_at, planned_entry, planned_stop, planned_direction, signal_detected_at, signal_instrument, signal_grade, signal_trading_session, signal_time_of_day, signal_day_of_week, actual_initial_stop, stop_provenance, r_vs_plan, r_vs_actual_risk, r_availability, r_math_version, net_r, commission, swap, cost_currency, cost_unit, verification_level, trade_state",
        )
        .order("created_at", { ascending: false })
        .limit(TRADE_PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as unknown as TradeRow[];
    },
  });
}

/**
 * Trades the user actually took, joined to their originating signal. Skipped
 * decisions are intentionally excluded — they are not retained.
 */
export function takenTradeHistoryQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["taken-trade-history", userId],
    enabled: !!userId,
    queryFn: async (): Promise<TradeHistoryRow[]> => {
      const { data, error } = await supabase
        .from("executed_trades" as never)
        .select(
          `id, user_id, signal_id, user_decision, outcome, realized_r_multiple, actual_entry_price, actual_exit_price, derived_r, price_source, price_source_client, price_recorded_at, decision_source, decision_source_client, notes, created_at, planned_entry, planned_stop, planned_direction, signal_detected_at, signal_instrument, signal_grade, signal_trading_session, signal_time_of_day, signal_day_of_week, actual_initial_stop, stop_provenance, r_vs_plan, r_vs_actual_risk, r_availability, r_math_version, net_r, commission, swap, cost_currency, cost_unit, verification_level, trade_state, scanned_signals(${SIGNAL_COLUMNS})`,
        )
        .eq("user_decision", "taken")
        .order("created_at", { ascending: false })
        .limit(TRADE_PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as unknown as TradeHistoryRow[];
    },
  });
}

export function settingsQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["scanner-settings", userId],
    enabled: !!userId,
    queryFn: async (): Promise<ScannerSettingsRow | null> => {
      const { data, error } = await supabase
        .from("scanner_settings" as never)
        .select(
          "user_id, instruments, timeframes, sessions, min_grade, alert_min_grade, daily_setup_cap, notify_push, notify_email, order_strategy, webhook_enabled, webhook_url, webhook_secret, webhook_format, account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent, equity_as_of, risk_ack_high",
        )
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as ScannerSettingsRow | null;
    },
  });
}

export function instrumentHealthQuery() {
  return queryOptions({
    queryKey: ["instrument-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instrument_health" as never)
        .select("instrument, available, last_error, unavailable_until, updated_at");
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        instrument: string;
        available: boolean;
        last_error: string | null;
        unavailable_until: string | null;
        updated_at: string | null;
      }>;
    },
  });
}

/**
 * Read-then-branch decision write. Insert initialises state and captures the
 * immutable journal snapshot; update touches decision + provenance only, so a
 * second tap can never reset a resolved trade's outcome to 'open'. A resolved
 * row is reported back rather than mutated (the database trigger would reject
 * the write anyway — this keeps the UI friendly instead of raw).
 */
export async function logDecision(input: {
  signalId: string;
  userId: string;
  decision: "taken" | "skipped";
}): Promise<DecisionResult> {
  const { data: existingRow, error: readError } = await supabase
    .from("executed_trades" as never)
    .select("id, outcome, user_decision")
    .eq("user_id", input.userId)
    .eq("signal_id", input.signalId)
    .maybeSingle();
  if (readError) throw readError;

  const existing = existingRow as {
    id: string;
    outcome: string;
    user_decision: string;
  } | null;
  const plan = planDecisionWrite(existing, input.decision);

  if (plan.action === "already_resolved") {
    return { ok: true, action: plan.action, alreadyResolved: true, message: plan.message };
  }

  if (plan.action === "update") {
    const { error } = await supabase
      .from("executed_trades" as never)
      .update({
        user_decision: input.decision,
        decision_source: "human",
        decision_source_client: null,
      } as never)
      .eq("id", existing!.id);
    if (error) throw error;
    return { ok: true, action: plan.action, alreadyResolved: false, message: plan.message };
  }

  // Insert path: snapshot the plan/context so journal maths never depends on
  // the signal row surviving retention.
  const { data: signalRow, error: signalError } = await supabase
    .from("scanned_signals" as never)
    .select(
      "id, detected_at, instrument, grade, direction, entry_price, stop_loss, market_context(trading_session, time_of_day, day_of_week)",
    )
    .eq("id", input.signalId)
    .maybeSingle();
  if (signalError) throw signalError;
  if (!signalRow) throw new Error("Signal not found");

  const snapshot = buildJournalSnapshot(signalRow as unknown as SignalSnapshotSource);

  const { error } = await supabase.from("executed_trades" as never).insert({
    user_id: input.userId,
    signal_id: input.signalId,
    user_decision: input.decision,
    outcome: "open",
    trade_state: "logged",
    r_math_version: R_MATH_VERSION,
    // Written from the web terminal by a person. Agent writes go through the
    // MCP tool, which stamps 'agent'.
    decision_source: "human",
    decision_source_client: null,
    ...snapshot,
  } as never);
  if (error) throw error;
  return { ok: true, action: plan.action, alreadyResolved: false, message: plan.message };
}


/**
 * Outcome writes go through `recordTradeOutcome` in
 * `src/lib/trade-journal.functions.ts`, which derives R server-side from the
 * user's real entry/exit prices. Client code must never write
 * `realized_r_multiple` or `derived_r` directly — an unverifiable R is exactly
 * what the integrity audit exists to catch.
 */

/** Permanent removal of one logged trade. RLS scopes this to the owner. */
export async function deleteTrade(input: { tradeId: string }) {
  const { error } = await supabase
    .from("executed_trades" as never)
    .delete()
    .eq("id", input.tradeId);
  if (error) throw error;
}

/** Clears the caller's entire personal trade log. Scanner data is untouched. */
export async function deleteAllTrades(input: { userId: string }) {
  const { error } = await supabase
    .from("executed_trades" as never)
    .delete()
    .eq("user_id", input.userId);
  if (error) throw error;
}

export async function saveSettings(input: Partial<ScannerSettingsRow> & { user_id: string }) {
  const { error } = await supabase
    .from("scanner_settings" as never)
    .upsert(input as never, { onConflict: "user_id" });
  if (error) throw error;
}

/**
 * Read-only feed of the learning engine's regime statistics, used by the
 * model-explain panel. Rebuilt hourly by the shadow-resolve cron; a small
 * table (~100 rows), so one cached select serves every open signal card.
 */
export function regimeStatsQuery() {
  return queryOptions({
    queryKey: ["regime-stats", ACTIVE_MODEL_VERSION],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RegimeStatRow[]> => {
      const { data, error } = await supabase
        .from("regime_stats" as never)
        .select(
          "tier, regime_key, instrument, direction, session, vol_bucket, n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2",
        )
        .eq("model_version", ACTIVE_MODEL_VERSION);
      if (error) throw error;
      return (data ?? []) as unknown as RegimeStatRow[];
    },
  });
}

export interface RegimeSnapshotRow {
  run_id: string;
  computed_at: string;
  tier: number;
  regime_key: string;
  instrument: string | null;
  direction: string | null;
  session: string | null;
  vol_bucket: string | null;
  n_total: number;
  n_filled: number;
  wins: number;
  p_fill_raw: number | null;
  p_win_raw: number | null;
  p_fill_shrunk: number | null;
  p_win_shrunk: number | null;
}

/**
 * Training-data history: one row per regime per hourly recompute, appended by
 * recompute_regime_stats(). Read-only; an empty result means the learning
 * engine has not completed an iteration yet and MUST render as such.
 */
export function regimeSnapshotsQuery(limit = 4000) {
  return queryOptions({
    queryKey: ["regime-snapshots", limit, ACTIVE_MODEL_VERSION],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RegimeSnapshotRow[]> => {
      const { data, error } = await supabase
        .from("regime_snapshots" as never)
        .select(
          "run_id, computed_at, tier, regime_key, instrument, direction, session, vol_bucket, n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk",
        )
        .eq("model_version", ACTIVE_MODEL_VERSION)
        // Tier 0 rows carry volatility boundaries, not regime statistics; they
        // are preserved for audit but never rendered as learning history.
        .gte("tier", 1)
        .order("computed_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []) as unknown as RegimeSnapshotRow[];
    },
  });
}
