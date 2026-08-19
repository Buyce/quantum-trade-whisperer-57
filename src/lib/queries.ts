import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RegimeStatRow } from "./learning/regime";
import type { ScannerSettingsRow, SignalRow, TradeHistoryRow, TradeRow } from "./db-types";

const SIGNAL_COLUMNS =
  "id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, tp1_r, tp2_r, tp3_r, max_r, max_acceptable_entry, structure_key, atr, rr_ratio, confidence_score, c_alignment, c_rr, c_symmetry, c_volatility, pattern_symmetry, p_trend, p_order_block, p_momentum, p_volatility_expansion, pillars_passed, h4_bias, h1_bias, m15_bias, qualitative_breakdown, status, resolved_outcome, resolved_r_multiple, expired_at, p_fill_prior, p_win_prior, ev_prior, prior_sample_n, prior_filled_n, prior_tier, market_context(trading_session, volatility_index, time_of_day, day_of_week)";

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


/** Bounded on purpose: an unlimited personal history grows without ceiling. */
const TRADE_PAGE_SIZE = 500;

export function myTradesQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["my-trades", userId],
    enabled: !!userId,
    queryFn: async (): Promise<TradeRow[]> => {
      const { data, error } = await supabase
        .from("executed_trades" as never)
        .select("id, user_id, signal_id, user_decision, outcome, realized_r_multiple, notes, created_at")
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
          `id, user_id, signal_id, user_decision, outcome, realized_r_multiple, notes, created_at, scanned_signals(${SIGNAL_COLUMNS})`,
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
        .select("user_id, instruments, timeframes, sessions, min_grade, alert_min_grade, daily_setup_cap, notify_push, notify_email, order_strategy, webhook_enabled, webhook_url, webhook_secret, webhook_format, account_equity, account_currency, risk_per_trade_percent, max_position_size, leverage, max_stop_loss_percent")
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

export async function logDecision(input: {
  signalId: string;
  userId: string;
  decision: "taken" | "skipped";
}) {
  const { error } = await supabase.from("executed_trades" as never).upsert(
    {
      user_id: input.userId,
      signal_id: input.signalId,
      user_decision: input.decision,
      outcome: "open",
    } as never,
    { onConflict: "user_id,signal_id" },
  );
  if (error) throw error;
}

export async function updateTradeResult(input: {
  tradeId: string;
  outcome: "win" | "loss" | "breakeven" | "open";
  realizedR: number | null;
}) {
  const { error } = await supabase
    .from("executed_trades" as never)
    .update({ outcome: input.outcome, realized_r_multiple: input.realizedR } as never)
    .eq("id", input.tradeId);
  if (error) throw error;
}

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
    queryKey: ["regime-stats"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RegimeStatRow[]> => {
      const { data, error } = await supabase
        .from("regime_stats" as never)
        .select(
          "tier, regime_key, instrument, direction, session, vol_bucket, n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2",
        );
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
  p_fill_shrunk: number;
  p_win_shrunk: number;
}

/**
 * Training-data history: one row per regime per hourly recompute, appended by
 * recompute_regime_stats(). Read-only; an empty result means the learning
 * engine has not completed an iteration yet and MUST render as such.
 */
export function regimeSnapshotsQuery(limit = 4000) {
  return queryOptions({
    queryKey: ["regime-snapshots", limit],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RegimeSnapshotRow[]> => {
      const { data, error } = await supabase
        .from("regime_snapshots" as never)
        .select(
          "run_id, computed_at, tier, regime_key, instrument, direction, session, vol_bucket, n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk",
        )
        .order("computed_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as RegimeSnapshotRow[];
    },
  });
}
