/**
 * Reads for the /accounts screen.
 *
 * Account rows, symbol maps, specs and feature state are read through the
 * REQUESTING USER's client, so row-level security is the enforcement boundary
 * even though the caller is already scoped by `userId`. Only the quota lookup
 * needs elevated access, and it returns nothing but two integers.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isReadOnly } from "@/lib/metaapi/classify";
import { isConnectionReady } from "./lifecycle";
import type {
  AccountFeatureRow,
  AccountQuotaView,
  AccountSpecRow,
  AccountSymbolRow,
  ConnectedAccountRow,
  ConnectedAccountView,
} from "./types";

type Client = SupabaseClient<never, never, never>;

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function toAccountView(
  supabase: unknown,
  row: ConnectedAccountRow,
): Promise<ConnectedAccountView> {
  const db = supabase as Client;
  const [symbols, specs, features] = await Promise.all([
    db
      .from("connected_account_symbols" as never)
      .select("canonical_symbol, broker_symbol, mapping_kind, candidates, resolved_at")
      .eq("account_id", row.id)
      .order("canonical_symbol"),
    db
      .from("connected_account_specs" as never)
      .select(
        "broker_symbol, canonical_symbol, contract_size, volume_min, volume_max, volume_step, stops_level, digits, point, fetched_at",
      )
      .eq("account_id", row.id)
      .order("broker_symbol"),
    db
      .from("connected_account_features" as never)
      .select(
        "metastats_api_enabled, risk_management_api_enabled, mt5_netting, risk_guardian_available, risk_guardian_reason, reliability, observed_at",
      )
      .eq("account_id", row.id)
      .maybeSingle(),
  ]);

  const readOnly = isReadOnly({
    investorMode: row.investor_mode,
    tradeAllowed: row.trade_allowed,
  });

  return {
    id: row.id,
    label: row.label,
    platform: row.platform,
    brokerServer: row.broker_server,
    region: row.region,
    intent: row.intent,
    phase: row.phase,
    mode: row.mode,
    ready: isConnectionReady({
      phase: row.phase,
      brokerAccountType: row.broker_account_type,
      intentConflict: row.intent_conflict,
    }),
    intentConflict: row.intent_conflict,
    intentConflictReason: row.intent_conflict_reason,
    // Only meaningful once the broker answered; before that it is not a claim.
    readOnly: row.broker_observed_at !== null && readOnly,
    broker: {
      accountType: row.broker_account_type,
      name: row.broker_name,
      loginMasked: row.broker_login_masked,
      currency: row.account_currency,
      balance: num(row.broker_balance),
      equity: num(row.broker_equity),
      freeMargin: num(row.broker_free_margin),
      marginLevel: num(row.broker_margin_level),
      leverage: num(row.leverage),
      tradeAllowed: row.trade_allowed,
      investorMode: row.investor_mode,
      marginMode: row.margin_mode,
      observedAt: row.broker_observed_at,
    },
    features: (features.data as AccountFeatureRow | null) ?? null,
    symbols: ((symbols.data ?? []) as AccountSymbolRow[]).map((s) => ({
      ...s,
      candidates: Array.isArray(s.candidates) ? s.candidates : [],
    })),
    specs: (specs.data ?? []) as AccountSpecRow[],
    lastError: row.last_error,
    lastReconciledAt: row.last_reconciled_at,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
  };
}

export async function loadAccountViews(
  supabase: unknown,
  userId: string,
): Promise<ConnectedAccountView[]> {
  const db = supabase as Client;
  const { data, error } = await db
    .from("connected_trading_accounts" as never)
    .select("*")
    .eq("user_id", userId)
    .is("disconnected_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ConnectedAccountRow[];
  return await Promise.all(rows.map((row) => toAccountView(db, row)));
}

export async function loadQuota(userId: string): Promise<AccountQuotaView> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Client;

  const { data: quota } = await db.rpc("account_quota" as never, { _user_id: userId } as never);
  const first = Array.isArray(quota) ? (quota[0] as { max_demo: number; max_live: number } | undefined) : undefined;

  const { data: rows } = await db
    .from("connected_trading_accounts" as never)
    .select("intent")
    .eq("user_id", userId)
    .is("disconnected_at", null);
  const used = (rows ?? []) as { intent: "demo" | "live" }[];

  return {
    maxDemo: first?.max_demo ?? 1,
    maxLive: first?.max_live ?? 1,
    usedDemo: used.filter((r) => r.intent === "demo").length,
    usedLive: used.filter((r) => r.intent === "live").length,
  };
}
