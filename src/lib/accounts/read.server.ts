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
import { pooledInclusionAllowed } from "@/lib/research/consent";
import { isConnectionReady } from "./lifecycle";
import { canArm, offerableModes, type ModeContext } from "./mode";
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
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Keep only finite numeric vendor metrics. A figure the vendor did not report
 * stays ABSENT rather than becoming a zero the UI could present as a fact.
 */
function numericMetrics(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function toAccountView(
  supabase: unknown,
  row: ConnectedAccountRow,
): Promise<ConnectedAccountView> {
  const db = supabase as Client;
  const [symbols, specs, features, telemetry, breaches] = await Promise.all([
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
    // The most recent vendor answer only. A `processing` or `unavailable` answer
    // carries no metrics object, so nothing here can be rounded to "zero trades".
    db
      .from("account_telemetry_snapshots" as never)
      .select("status, reason, metrics, observed_at")
      .eq("account_id", row.id)
      .eq("source", "metastats")
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("account_risk_events" as never)
      .select("event_at, relative_drawdown, absolute_drawdown")
      .eq("account_id", row.id)
      .order("event_at", { ascending: false })
      .limit(5),
  ]);

  const modeContext: ModeContext = {
    brokerAccountType: row.broker_account_type,
    ready: isConnectionReady({
      phase: row.phase,
      brokerAccountType: row.broker_account_type,
      intentConflict: row.intent_conflict,
    }),
    intentConflict: row.intent_conflict,
    tradeAllowed: row.trade_allowed,
    investorMode: row.investor_mode,
    hasBrokerConnection: Boolean(row.metaapi_account_id),
    hasMagic: typeof row.magic === "number" && row.magic > 0,
  };
  // The refusal sentence is taken from the mode matching the BROKER's own account
  // type, so the explanation never describes a mode this account could not have.
  const armVerdict = canArm(
    modeContext,
    row.broker_account_type === "real" ? "live_confirm" : "demo_auto",
  );

  const readOnly = isReadOnly({
    investorMode: row.investor_mode,
    tradeAllowed: row.trade_allowed,
  });
  const researchConsent = pooledInclusionAllowed({
    researchConsent: row.research_consent,
    researchConsentVersion: row.research_consent_version,
    researchConsentAt: row.research_consent_at,
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
    maxAccountOpenPositions: num(row.max_account_open_positions),
    isBenchmark: row.is_benchmark === true,
    researchConsent: {
      enabled: row.research_consent === true,
      version: row.research_consent_version,
      updatedAt: row.research_consent_at,
      current: researchConsent.included,
    },
    offerableModes: offerableModes(modeContext),
    armRefusal: armVerdict.ok ? null : armVerdict.detail,
    telemetry: telemetry.data
      ? {
          status: (telemetry.data as { status: string }).status,
          reason: (telemetry.data as { reason: string | null }).reason ?? null,
          observedAt: (telemetry.data as { observed_at: string | null }).observed_at ?? null,
          metrics: numericMetrics((telemetry.data as { metrics: unknown }).metrics),
        }
      : null,
    riskBreaches: (
      (breaches.data ?? []) as {
        event_at: string;
        relative_drawdown: number | null;
        absolute_drawdown: number | null;
      }[]
    ).map((e) => ({
      eventAt: e.event_at,
      relativeDrawdown: num(e.relative_drawdown),
      absoluteDrawdown: num(e.absolute_drawdown),
    })),
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
  const first = Array.isArray(quota)
    ? (quota[0] as { max_demo: number; max_live: number } | undefined)
    : undefined;

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
