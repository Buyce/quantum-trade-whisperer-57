import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ScannerSettingsRow, SignalRow, TradeRow } from "./db-types";

const SIGNAL_COLUMNS =
  "id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, atr, rr_ratio, confidence_score, c_alignment, c_rr, c_symmetry, c_volatility, pattern_symmetry, p_trend, p_order_block, p_momentum, p_volatility_expansion, pillars_passed, h4_bias, h1_bias, m15_bias, qualitative_breakdown, status, resolved_outcome, resolved_r_multiple, market_context(trading_session, volatility_index, time_of_day, day_of_week)";

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
      return (data ?? []) as unknown as SignalRow[];
    },
  });
}

export function myTradesQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["my-trades", userId],
    enabled: !!userId,
    queryFn: async (): Promise<TradeRow[]> => {
      const { data, error } = await supabase
        .from("executed_trades" as never)
        .select("id, user_id, signal_id, user_decision, outcome, realized_r_multiple, notes, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TradeRow[];
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
        .select("user_id, instruments, timeframes, sessions, min_grade, daily_setup_cap, notify_push, notify_email")
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
        .select("instrument, available, last_error, unavailable_until");
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        instrument: string;
        available: boolean;
        last_error: string | null;
        unavailable_until: string | null;
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

export async function saveSettings(input: Partial<ScannerSettingsRow> & { user_id: string }) {
  const { error } = await supabase
    .from("scanner_settings" as never)
    .upsert(input as never, { onConflict: "user_id" });
  if (error) throw error;
}
