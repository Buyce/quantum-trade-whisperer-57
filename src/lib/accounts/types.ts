/**
 * Row and DTO shapes for connected broker accounts.
 *
 * Every `broker_*` field is BROKER-DERIVED (MetaApi Client API account
 * information). `intent` is onboarding intent only and is never authoritative.
 */
import type { AccountType } from "@/lib/metaapi/classify";
import type { MetaApiPlatform } from "@/lib/metaapi/types";
import type { AccountPhase, ConnectionIntent } from "./lifecycle";
import type { SymbolMappingKind } from "./symbol-map";

export type AccountMode = "observe" | "demo_auto" | "live_confirm" | "live_auto";

export interface ConnectedAccountRow {
  id: string;
  user_id: string;
  metaapi_account_id: string | null;
  provision_transaction_id: string;
  label: string;
  platform: MetaApiPlatform;
  broker_server: string | null;
  region: string;
  magic: number | null;
  intent: ConnectionIntent;
  phase: AccountPhase;
  credentials_configured: boolean;
  provisioning_state: string | null;
  connection_status: string | null;
  broker_account_type: AccountType;
  broker_name: string | null;
  broker_login_masked: string | null;
  account_currency: string | null;
  trade_allowed: boolean | null;
  investor_mode: boolean | null;
  margin_mode: string | null;
  leverage: number | null;
  broker_balance: number | null;
  broker_equity: number | null;
  broker_free_margin: number | null;
  broker_margin_level: number | null;
  broker_observed_at: string | null;
  mode: AccountMode;
  intent_conflict: boolean;
  intent_conflict_reason: string | null;
  last_error: string | null;
  last_reconciled_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountSymbolRow {
  canonical_symbol: string;
  broker_symbol: string | null;
  mapping_kind: SymbolMappingKind;
  candidates: string[];
  resolved_at: string;
}

export interface AccountFeatureRow {
  metastats_api_enabled: boolean;
  risk_management_api_enabled: boolean;
  mt5_netting: boolean;
  risk_guardian_available: boolean;
  risk_guardian_reason: string | null;
  reliability: string | null;
  observed_at: string;
}

export interface AccountSpecRow {
  broker_symbol: string;
  canonical_symbol: string | null;
  contract_size: number | null;
  volume_min: number | null;
  volume_max: number | null;
  volume_step: number | null;
  stops_level: number | null;
  digits: number | null;
  point: number | null;
  fetched_at: string;
}

/** What the /accounts screen renders. */
export interface ConnectedAccountView {
  id: string;
  label: string;
  platform: MetaApiPlatform;
  brokerServer: string | null;
  region: string;
  intent: ConnectionIntent;
  phase: AccountPhase;
  mode: AccountMode;
  ready: boolean;
  intentConflict: boolean;
  intentConflictReason: string | null;
  readOnly: boolean;
  /** Broker-derived block. Absent fields stay null — never defaulted. */
  broker: {
    accountType: AccountType;
    name: string | null;
    loginMasked: string | null;
    currency: string | null;
    balance: number | null;
    equity: number | null;
    freeMargin: number | null;
    marginLevel: number | null;
    leverage: number | null;
    tradeAllowed: boolean | null;
    investorMode: boolean | null;
    marginMode: string | null;
    observedAt: string | null;
  };
  features: AccountFeatureRow | null;
  symbols: AccountSymbolRow[];
  specs: AccountSpecRow[];
  lastError: string | null;
  lastReconciledAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
}

export interface AccountQuotaView {
  maxDemo: number;
  maxLive: number;
  usedDemo: number;
  usedLive: number;
}
