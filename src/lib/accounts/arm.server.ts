/**
 * Prompt 14 Stage 3 closure (A) — arming a connected account for automatic
 * orders.
 *
 * Customer Demo Auto is only reachable through this path. The pure rules live
 * in `./mode.ts`; this module does the I/O: it re-reads the row the trader
 * actually owns, re-applies those rules against the BROKER's own facts, and
 * refuses a live mode outright unless the operator has enabled live execution
 * system-wide.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canArm, isAccountMode } from "./mode";
import type { AccountMode } from "./types";

const TABLE = "connected_trading_accounts";

export interface ArmResult {
  mode: AccountMode;
}

export async function setAccountMode(
  userId: string,
  accountId: string,
  mode: string,
): Promise<ArmResult> {
  if (!isAccountMode(mode)) throw new Error("Unknown execution mode.");

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(
      "id, phase, mode, magic, metaapi_account_id, intent_conflict, trade_allowed, investor_mode, broker_account_type",
    )
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That broker account was not found on your profile.");

  const row = data as {
    phase: string;
    magic: number | null;
    metaapi_account_id: string | null;
    intent_conflict: boolean | null;
    trade_allowed: boolean | null;
    investor_mode: boolean | null;
    broker_account_type: "demo" | "live" | "unknown" | null;
  };

  const verdict = canArm(
    {
      brokerAccountType: row.broker_account_type ?? "unknown",
      ready: row.phase === "ready",
      intentConflict: row.intent_conflict === true,
      tradeAllowed: row.trade_allowed,
      investorMode: row.investor_mode,
      hasBrokerConnection: Boolean(row.metaapi_account_id),
      hasMagic: typeof row.magic === "number" && row.magic > 0,
    },
    mode,
  );
  if (!verdict.ok) throw new Error(verdict.detail);

  // A live mode also needs the system-wide live switch; without it, arming would
  // create an account that looks live-armed but can never send.
  if (mode === "live_auto" || mode === "live_confirm") {
    const { data: controls } = await supabaseAdmin
      .from("execution_controls")
      .select("live_execution_enabled")
      .eq("id", 1)
      .maybeSingle();
    if ((controls as { live_execution_enabled?: boolean } | null)?.live_execution_enabled !== true) {
      throw new Error("Live execution is disabled system-wide, so a live mode cannot be armed.");
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from(TABLE)
    .update({ mode } as never)
    .eq("id", accountId)
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);

  return { mode };
}
