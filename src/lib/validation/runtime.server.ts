/**
 * Admin Runtime Validation — strictly non-trading.
 *
 * Walks one connected account through the same preparation chain an order
 * would use (existing functions only) and stops before submission. The first
 * failing gate ends the run; later gates are NOT_REACHED. This module must
 * never import trade.server, delivery send paths, arm.server or settings
 * writers — enforced by runtime-validation.test.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAccountFacts } from "@/lib/metaapi/accounts.server";
import { fetchQuoteFor } from "@/lib/metaapi/market.server";
import { estimateMargin } from "@/lib/metaapi/margin.server";
import { classifyMetaApiFailure } from "@/lib/metaapi/errors";
import { accountExecutionPolicy } from "@/lib/accounts/policy.server";
import { loadAccountSizingSpec, accountSpecStale } from "@/lib/accounts/specs.server";
import { resolveMapping } from "@/lib/instruments/mapping.server";
import { resizeFromBrokerSnapshot } from "@/lib/execution/resize.server";
import { GATES, sanitizeReport, type GateName, type GateResult, type ValidationReport } from "./report";

export interface RuntimeValidationDeps {
  fetchAccountFacts: typeof fetchAccountFacts;
  fetchQuoteFor: typeof fetchQuoteFor;
  estimateMargin: typeof estimateMargin;
  accountExecutionPolicy: typeof accountExecutionPolicy;
  loadAccountSizingSpec: typeof loadAccountSizingSpec;
  accountSpecStale: typeof accountSpecStale;
  resolveMapping: typeof resolveMapping;
  resizeFromBrokerSnapshot: typeof resizeFromBrokerSnapshot;
  now: () => number;
}

export const defaultDeps: RuntimeValidationDeps = {
  fetchAccountFacts,
  fetchQuoteFor,
  estimateMargin,
  accountExecutionPolicy,
  loadAccountSizingSpec,
  accountSpecStale,
  resolveMapping,
  resizeFromBrokerSnapshot,
  now: () => Date.now(),
};

export interface RuntimeValidationInput {
  accountId: string;
  symbol: string;
  direction: "long" | "short";
  /** Stop distance in price units used to size the hypothetical order. */
  stopDistance: number;
}

export const QUOTE_MAX_AGE_MS = 60_000;
export const FACTS_MAX_AGE_MS = 5 * 60_000;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function errText(err: unknown): string {
  const f = classifyMetaApiFailure(err);
  return `${f.kind}${f.status ? ` (HTTP ${f.status})` : ""}`;
}

export async function runRuntimeValidation(
  db: SupabaseClient,
  input: RuntimeValidationInput,
  deps: RuntimeValidationDeps = defaultDeps,
): Promise<ValidationReport> {
  const canonical = input.symbol.trim().toUpperCase();
  const r: Record<string, unknown> = { account_id: input.accountId, canonical_symbol: canonical };
  const gates: GateResult[] = [];
  const pass = (g: GateName) => gates.push({ gate: g, status: "PASS", reason: null });
  const finish = (g: GateName, reason: string) => {
    gates.push({ gate: g, status: "FAIL", reason });
    for (const rest of GATES.slice(gates.length))
      gates.push({ gate: rest, status: "NOT_REACHED", reason: null });
    return sanitizeReport({ ...r, gates });
  };

  // 1. Connection
  const { data: acct, error } = await db
    .from("connected_trading_accounts")
    .select(
      "id, user_id, label, metaapi_account_id, region, connection_status, provisioning_state, disconnected_at, broker_server",
    )
    .eq("id", input.accountId)
    .maybeSingle();
  if (error || !acct) return finish("connection", error ? "account unreadable" : "account not found");
  const a = acct as Record<string, unknown>;
  r["label"] = a["label"];
  r["connection_state"] = a["connection_status"] ?? null;
  const metaId = typeof a["metaapi_account_id"] === "string" ? a["metaapi_account_id"] : "";
  const region = typeof a["region"] === "string" ? a["region"] : "";
  const userId = String(a["user_id"]);
  if (a["disconnected_at"]) return finish("connection", "account is disconnected");
  if (!metaId || !region) return finish("connection", "no MetaApi connection configured");
  if (a["provisioning_state"] && a["provisioning_state"] !== "DEPLOYED")
    return finish("connection", `provisioning state is ${String(a["provisioning_state"])}`);
  if (a["connection_status"] !== "CONNECTED")
    return finish("connection", `connection status is ${String(a["connection_status"] ?? "unknown")}`);
  pass("connection");

  // 2. Fresh broker facts
  let facts;
  try {
    facts = await deps.fetchAccountFacts(metaId, region);
  } catch (e) {
    return finish("broker_facts", `account information request failed: ${errText(e)}`);
  }
  if (!facts) return finish("broker_facts", "broker returned no account information");
  r["balance"] = facts.info.balance;
  r["equity"] = facts.info.equity;
  r["free_margin"] = facts.info.freeMargin;
  r["currency"] = facts.info.currency ?? null;
  r["broker_observed_at"] = facts.observedAt;
  r["classification"] = facts.type;
  const equity = typeof facts.info.equity === "number" ? facts.info.equity : null;
  if (equity === null || !Number.isFinite(equity) || equity <= 0)
    return finish("broker_facts", "broker equity unavailable");
  if (deps.now() - Date.parse(facts.observedAt) > FACTS_MAX_AGE_MS)
    return finish("broker_facts", "broker facts are stale");
  pass("broker_facts");

  // 3. Account type and permissions
  if (facts.type === "unknown") return finish("account_permissions", "broker account type unknown");
  if (facts.info.investorMode === true)
    return finish("account_permissions", "investor (read-only) password connected");
  if (facts.info.tradeAllowed !== true)
    return finish("account_permissions", "broker reports trading not allowed");
  pass("account_permissions");

  // 4. Risk policy (read-only)
  const { data: pol } = await db
    .from("connected_account_risk_policies" as never)
    .select("id")
    .eq("account_id", input.accountId)
    .eq("user_id", userId)
    .maybeSingle();
  r["policy_id"] = (pol as { id?: string } | null)?.id ?? null;
  const policy = await deps.accountExecutionPolicy(db, {
    accountId: input.accountId,
    userId,
    equity,
    balance: facts.info.balance ?? null,
    now: deps.now(),
  });
  if (!policy.ok) return finish("risk_policy", policy.detail);
  r["risk_percent"] = policy.riskPercent;
  pass("risk_policy");

  // 5. Symbol mapping
  const mapping = await deps.resolveMapping(db, {
    canonical,
    accountId: input.accountId,
    server: typeof a["broker_server"] === "string" ? a["broker_server"] : null,
    now: new Date(deps.now()),
  });
  r["broker_symbol"] = mapping.providerSymbol;
  if (!mapping.usable || !mapping.providerSymbol)
    return finish("symbol_mapping", `${mapping.refusal ?? mapping.status}: ${mapping.detail}`);
  pass("symbol_mapping");

  // 6. Quote and specification
  let quote;
  try {
    quote = await deps.fetchQuoteFor(metaId, region, mapping.providerSymbol);
  } catch (e) {
    return finish("quote_and_spec", `quote request failed: ${errText(e)}`);
  }
  if (!quote) return finish("quote_and_spec", "broker returned no valid quote");
  const quoteTime = Date.parse(quote.sourceTime ?? quote.receivedAt);
  if (!Number.isFinite(quoteTime) || deps.now() - quoteTime > QUOTE_MAX_AGE_MS)
    return finish("quote_and_spec", "quote is stale");
  const spec = await deps.loadAccountSizingSpec(db, input.accountId, canonical);
  if (!spec) return finish("quote_and_spec", "account symbol specification missing");
  if (deps.accountSpecStale(spec, deps.now()))
    return finish("quote_and_spec", "account symbol specification is stale");
  pass("quote_and_spec");

  // 7. Sizing
  const entry = input.direction === "long" ? quote.ask : quote.bid;
  const stop = input.direction === "long" ? entry - input.stopDistance : entry + input.stopDistance;
  if (!(input.stopDistance > 0) || !(stop > 0)) return finish("sizing", "invalid stop distance");
  const sized = await deps.resizeFromBrokerSnapshot(
    db,
    {
      userId,
      accountId: input.accountId,
      instrument: canonical,
      entryPrice: entry,
      stopLoss: stop,
      signalId: NIL_UUID,
      deliveryId: -1,
      riskPercent: policy.riskPercent,
    },
    { equity, balance: facts.info.balance ?? null, currency: facts.info.currency ?? null, observedAt: facts.observedAt },
    deps.now(),
  );
  if (!sized.ok) return finish("sizing", `${sized.reason}: ${sized.detail}`);
  r["lots"] = sized.quantity.lots;
  r["risk_amount"] = sized.risk.amount;
  pass("sizing");

  // 8. Margin (calculate-margin only)
  try {
    const margin = await deps.estimateMargin(metaId, region, {
      symbol: mapping.providerSymbol,
      type: input.direction === "long" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
      volume: sized.quantity.lots,
      openPrice: entry,
    });
    r["required_margin"] = margin;
    const free = typeof facts.info.freeMargin === "number" ? facts.info.freeMargin : null;
    if (free !== null && margin > free)
      return finish("margin", `required margin ${margin} exceeds free margin ${free}`);
  } catch (e) {
    return finish("margin", `margin calculation failed: ${errText(e)}`);
  }
  pass("margin");

  // 9. Reconciliation health (read-only)
  const { data: open, error: dErr } = await db
    .from("reconciliation_discrepancies")
    .select("id, severity")
    .eq("account_id", input.accountId)
    .eq("status", "open");
  if (dErr) return finish("reconciliation", "reconciliation state unreadable");
  const critical = (open ?? []).filter((d) => (d as { severity?: string }).severity === "critical");
  if (critical.length > 0)
    return finish("reconciliation", `${critical.length} open critical discrepancy(ies)`);
  pass("reconciliation");

  return sanitizeReport({ ...r, gates });
}
