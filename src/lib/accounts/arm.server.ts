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
import type { AccountType } from "@/lib/metaapi/classify";
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
    broker_account_type: AccountType | null;
  };

  const { isReservedRemoteAccount } = await import("./provision.server");
  if (isReservedRemoteAccount(row.metaapi_account_id)) {
    throw new Error(
      "This connection points at a trading account reserved by P-Trades, so it can never be armed. Disconnect it and connect your own account instead.",
    );
  }

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

  // An automatic mode also needs the matching system-wide capability at the
  // moment of arming. Without this an account could be saved as `demo_auto`
  // while Demo Auto is unavailable and then start trading later, purely because
  // an operator flipped a switch — authorisation the trader never gave for that
  // state of the system. Demo money is still the trader's decision, so we refuse
  // now and ask for an explicit enable once the capability exists.
  if (mode !== "observe") {
    const { data: controlsRow } = await supabaseAdmin
      .from("execution_controls")
      .select("live_execution_enabled, demo_auto_enabled, live_auto_enabled")
      .eq("id", true)
      .maybeSingle();
    const controls = controlsRow as {
      live_execution_enabled?: boolean;
      demo_auto_enabled?: boolean;
      live_auto_enabled?: boolean;
    } | null;

    if (mode === "demo_auto" && controls?.demo_auto_enabled !== true) {
      throw new Error(
        "Demo auto-execution is currently unavailable system-wide, so it cannot be armed. Enable it again once the capability is back — authorisation is never carried over silently.",
      );
    }
    if (mode === "live_auto" || mode === "live_confirm") {
      if (controls?.live_execution_enabled !== true) {
        throw new Error("Live execution is disabled system-wide, so a live mode cannot be armed.");
      }
      if (mode === "live_auto" && controls?.live_auto_enabled !== true) {
        throw new Error(
          "Live auto-execution is currently unavailable system-wide, so it cannot be armed.",
        );
      }
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
