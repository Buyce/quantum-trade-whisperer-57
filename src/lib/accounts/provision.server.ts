/**
 * Server-only orchestration for customer broker connections.
 *
 * Invariants enforced here and nowhere else:
 *  - Every operation is scoped by `user_id` FIRST. A MetaApi account id supplied
 *    by a client is never used to address MetaApi; only an id we previously
 *    stored for that user is.
 *  - The benchmark account can never be reached through this path, so a customer
 *    can neither read nor mutate it.
 *  - No MetaTrader password crosses this module, and configuration-link URLs are
 *    returned to the owner's browser only: never persisted, never logged.
 *  - Broker classification is written only from MetaApi's own account
 *    information. Nothing here trusts the trader's demo/live choice.
 *  - Stage 2 keeps `mode` at `observe`; no execution is possible.
 */
import { randomUUID } from "node:crypto";

import { classifyAccountType, isMt5Netting, riskGuardianAvailability } from "@/lib/metaapi/classify";
import { hasBenchmarkAccount, readBenchmarkAccount } from "@/lib/metaapi/config.server";
import { classifyMetaApiFailure } from "@/lib/metaapi/errors";
import { fetchAccountInformation } from "@/lib/metaapi/accounts.server";
import {
  createAccount,
  createConfigurationLink,
  deleteAccount,
  deployAccount,
  fetchProvisionedAccount,
  undeployAccount,
} from "@/lib/metaapi/provision.server";
import { fetchSymbols, fetchTypedSymbolSpecification } from "@/lib/metaapi/specs.server";
import { INSTRUMENTS } from "@/lib/scanner/types";
import type { BrokerAccountInformation, MetaApiPlatform } from "@/lib/metaapi/types";
import {
  evaluateIntent,
  maskLogin,
  planDisconnect,
  type AccountPhase,
  type ConnectionIntent,
} from "./lifecycle";
import { isOfferedRegion } from "./guidance";
import { mapSymbols } from "./symbol-map";
import type { ConnectedAccountRow } from "./types";

const TABLE = "connected_trading_accounts";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

async function admin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Never let a customer operation address the benchmark account. */
function assertNotBenchmark(metaapiAccountId: string): void {
  if (!hasBenchmarkAccount()) return;
  if (readBenchmarkAccount().accountId === metaapiAccountId) {
    throw new Error("This account is reserved by P-Trades and cannot be managed here.");
  }
}

export interface StartConnectionInput {
  userId: string;
  label: string;
  platform: MetaApiPlatform;
  brokerServer: string;
  region: string;
  intent: ConnectionIntent;
}

export interface StartConnectionResult {
  accountId: string;
  /** MetaApi's hosted credential page. Shown once; never stored. */
  configurationUrl: string | null;
  configurationExpiresAt: string | null;
}

function cleanLabel(raw: string): string {
  const label = raw.trim().replace(/\s+/g, " ").slice(0, 60);
  if (label.length < 2) throw new Error("Give this connection a name of at least 2 characters.");
  return label;
}

function cleanServer(raw: string): string {
  const server = raw.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,63}$/.test(server)) {
    throw new Error(
      "That broker server name does not look right. Copy it exactly as your MetaTrader app shows it, for example MetaQuotes-Demo.",
    );
  }
  return server;
}

/**
 * Step 1 of the wizard: reserve the connection, create a DRAFT MetaApi account
 * with NO credentials, and hand back a one-time hosted page where the owner
 * enters their broker login.
 */
export async function startConnection(
  input: StartConnectionInput,
): Promise<StartConnectionResult> {
  const db = await admin();
  const label = cleanLabel(input.label);
  const server = cleanServer(input.brokerServer);
  if (!isOfferedRegion(input.region)) throw new Error("Choose one of the offered regions.");
  if (input.platform !== "mt4" && input.platform !== "mt5") {
    throw new Error("Choose MT4 or MT5.");
  }

  const transactionId = randomUUID();

  // The quota is enforced by a database trigger, so this insert is the gate.
  const { data: inserted, error: insertError } = await db
    .from(TABLE as never)
    .insert({
      user_id: input.userId,
      provision_transaction_id: transactionId,
      label,
      platform: input.platform,
      broker_server: server,
      region: input.region,
      intent: input.intent,
      phase: "awaiting_credentials" satisfies AccountPhase,
      mode: "observe",
    } as never)
    .select("id")
    .single();

  if (insertError) {
    if (insertError.message.includes("account_quota_exceeded")) {
      throw new Error(
        `You have reached your limit of connected ${input.intent} accounts. Disconnect the existing one first.`,
      );
    }
    throw new Error(insertError.message);
  }
  const rowId = (inserted as { id: string }).id;

  try {
    const created = await createAccount(
      {
        name: `P-Trades ${label}`,
        platform: input.platform,
        server,
        region: input.region,
        magic: 0,
        // Prompt 14 Stage 5 (pre-flight 3): Increased Reliability is a separately
        // billed MetaApi option. Ordinary customer provisioning never enables it
        // on the operator's behalf; it is an explicit product decision.
        reliability: "regular",
        manualTrades: true,
        // Prompt 14 Stage 3 closure (E): MetaStats and the Risk Management API
        // are separately billed MetaApi features. A customer connection never
        // silently opts the operator into them; Stage 5 enables them explicitly
        // per account when telemetry is requested.
        metastatsApiEnabled: false,
        riskManagementApiEnabled: false,
        draft: true,
      },
      transactionId,
    );
    assertNotBenchmark(created.id);

    await db
      .from(TABLE as never)
      .update({
        metaapi_account_id: created.id,
        provisioning_state: created.state,
        phase: "awaiting_credentials" satisfies AccountPhase,
      } as never)
      .eq("id", rowId);

    const link = await createConfigurationLink(created.id);
    return {
      accountId: rowId,
      configurationUrl: link?.url ?? null,
      configurationExpiresAt: link?.expiresAt ?? null,
    };
  } catch (err) {
    const failure = classifyMetaApiFailure(err);
    await db
      .from(TABLE as never)
      .update({ phase: "failed" satisfies AccountPhase, last_error: failure.message } as never)
      .eq("id", rowId);
    throw new Error(failure.message);
  }
}

async function ownedRow(userId: string, accountId: string): Promise<ConnectedAccountRow> {
  const db = await admin();
  const { data, error } = await db
    .from(TABLE as never)
    .select("*")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Connection not found.");
  const row = data as unknown as ConnectedAccountRow;
  if (row.metaapi_account_id) assertNotBenchmark(row.metaapi_account_id);
  return row;
}

/** Re-issue the hosted credential page for a connection that is still waiting. */
export async function reissueConfigurationLink(
  userId: string,
  accountId: string,
): Promise<{ configurationUrl: string; expiresAt: string }> {
  const row = await ownedRow(userId, accountId);
  if (row.disconnected_at) throw new Error("This connection has been disconnected.");
  if (!row.metaapi_account_id) {
    throw new Error("This connection was never created with your broker-connection provider.");
  }
  const link = await createConfigurationLink(row.metaapi_account_id);
  if (!link) throw new Error("Your broker-connection provider did not return a secure page.");
  return { configurationUrl: link.url, expiresAt: link.expiresAt };
}

/**
 * Advance the lifecycle from whatever MetaApi and the broker currently report.
 *
 * DRAFT → (credentials configured) → DEPLOYED → CONNECTED → account-info
 * verified → READY. Each call performs at most one push forward, so the wizard
 * shows real progress rather than a spinner that lies.
 */
export async function reconcileConnection(
  userId: string,
  accountId: string,
): Promise<ConnectedAccountRow> {
  const db = await admin();
  const row = await ownedRow(userId, accountId);
  if (row.disconnected_at) return row;
  if (!row.metaapi_account_id) return row;

  const patch: Record<string, unknown> = { last_reconciled_at: new Date().toISOString() };

  try {
    const remote = await fetchProvisionedAccount(row.metaapi_account_id);
    if (!remote) throw new Error("Your broker-connection provider has no record of this connection.");

    const state = (remote.state ?? "").toString().toUpperCase();
    const status = (remote.connectionStatus ?? "").toString().toUpperCase();
    const credentialsConfigured = remote.login !== null && remote.login !== undefined;

    patch["provisioning_state"] = remote.state ?? null;
    patch["connection_status"] = remote.connectionStatus ?? null;
    patch["credentials_configured"] = credentialsConfigured;
    patch["last_error"] = null;

    if (!credentialsConfigured) {
      patch["phase"] = "awaiting_credentials" satisfies AccountPhase;
      return await writeAndReturn(db, row.id, patch);
    }

    // Credentials are in place: make sure the connection is actually running.
    if (state === "DRAFT" || state === "UNDEPLOYED" || state === "CREATED") {
      await deployAccount(row.metaapi_account_id);
      patch["phase"] = "deploying" satisfies AccountPhase;
      return await writeAndReturn(db, row.id, patch);
    }
    if (state === "DEPLOY_FAILED" || state === "REDEPLOY_FAILED" || state === "UNDEPLOY_FAILED") {
      patch["phase"] = "failed" satisfies AccountPhase;
      patch["last_error"] = `Your broker-connection provider reported ${state}.`;
      return await writeAndReturn(db, row.id, patch);
    }
    if (state === "DEPLOYING" || state === "UNDEPLOYING") {
      patch["phase"] = "deploying" satisfies AccountPhase;
      return await writeAndReturn(db, row.id, patch);
    }
    if (status === "DISCONNECTED_FROM_BROKER") {
      patch["phase"] = "broker_rejected" satisfies AccountPhase;
      return await writeAndReturn(db, row.id, patch);
    }
    if (status !== "CONNECTED") {
      patch["phase"] = "deployed_not_connected" satisfies AccountPhase;
      return await writeAndReturn(db, row.id, patch);
    }

    // Connected: the broker's own account information is the authority.
    const info = await fetchAccountInformation(row.metaapi_account_id, row.region);
    if (!info || typeof info !== "object") {
      patch["phase"] = "connected" satisfies AccountPhase;
      return await writeAndReturn(db, row.id, patch);
    }

    const type = classifyAccountType(info);
    const verdict = evaluateIntent(row.intent, type);
    Object.assign(patch, brokerFactsPatch(info, type));
    patch["intent_conflict"] = verdict.conflict;
    patch["intent_conflict_reason"] = verdict.reason;

    // Prompt 14 Stage 5 (pre-flight 1): an ordinary refresh must NOT silently
    // disarm a valid Demo Auto account. The armed mode survives while the
    // BROKER's own facts still support it, and stands down immediately — with
    // the reason recorded — the moment they do not (real money, investor
    // /read-only, trading not allowed, conflicted, or no order tag).
    const outcome = modeAfterReconcile(isAccountMode(row.mode) ? row.mode : "observe", {
      brokerAccountType: type,
      ready: !verdict.conflict && type !== "unknown",
      intentConflict: verdict.conflict,
      tradeAllowed: info.tradeAllowed ?? null,
      investorMode: info.investorMode ?? null,
      hasBrokerConnection: true,
      hasMagic: typeof row.magic === "number" && row.magic > 0,
    });
    patch["mode"] = outcome.mode;
    patch["stand_down_reason"] = outcome.standDownReason;
    patch["phase"] = (
      verdict.conflict || type === "unknown" ? "connected" : "ready"
    ) satisfies AccountPhase;

    await writeFeatures(db, row, info, remote);

    // A conflicted connection is a hard stop: nothing further is read from it.
    if (!verdict.conflict) {
      await refreshSymbolMap(db, row, info.platform ?? row.platform);
    }

    return await writeAndReturn(db, row.id, patch);
  } catch (err) {
    const failure = classifyMetaApiFailure(err);
    patch["last_error"] = failure.message;
    if (failure.kind === "timeout" || failure.kind === "rate_limited") {
      // Transient: keep the phase, record why the refresh could not complete.
      return await writeAndReturn(db, row.id, patch);
    }
    return await writeAndReturn(db, row.id, patch);
  }
}

function brokerFactsPatch(
  info: BrokerAccountInformation,
  type: ReturnType<typeof classifyAccountType>,
): Record<string, unknown> {
  const num = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    broker_account_type: type,
    broker_name: info.broker ?? null,
    broker_login_masked: maskLogin(info.login),
    account_currency: info.currency ?? null,
    trade_allowed: typeof info.tradeAllowed === "boolean" ? info.tradeAllowed : null,
    investor_mode: typeof info.investorMode === "boolean" ? info.investorMode : null,
    margin_mode: info.marginMode ?? null,
    leverage: num(info.leverage),
    // Broker-reported figures. The trader's own risk equity in Settings is a
    // separate, user-entered value and is never overwritten from here.
    broker_balance: num(info.balance),
    broker_equity: num(info.equity),
    broker_free_margin: num(info.freeMargin),
    broker_margin_level: num(info.marginLevel),
    broker_observed_at: new Date().toISOString(),
  };
}

async function writeAndReturn(
  db: Admin,
  rowId: string,
  patch: Record<string, unknown>,
): Promise<ConnectedAccountRow> {
  const { data, error } = await db
    .from(TABLE as never)
    .update(patch as never)
    .eq("id", rowId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as ConnectedAccountRow;
}

async function writeFeatures(
  db: Admin,
  row: ConnectedAccountRow,
  info: BrokerAccountInformation,
  remote: { metastatsApiEnabled?: boolean | null; riskManagementApiEnabled?: boolean | null; reliability?: string | null },
): Promise<void> {
  const netting = isMt5Netting(info);
  const guardian = riskGuardianAvailability(info, remote.riskManagementApiEnabled === true);
  await db.from("connected_account_features" as never).upsert(
    {
      account_id: row.id,
      user_id: row.user_id,
      metastats_api_enabled: remote.metastatsApiEnabled === true,
      risk_management_api_enabled: remote.riskManagementApiEnabled === true,
      mt5_netting: netting,
      risk_guardian_available: guardian.available,
      risk_guardian_reason: guardian.reason,
      reliability: remote.reliability ?? null,
      observed_at: new Date().toISOString(),
    } as never,
    { onConflict: "account_id" },
  );
}

/**
 * Resolve P-Trades' instruments against THIS broker's own symbol list and store
 * the account-scoped specification for each resolved symbol.
 *
 * Benchmark specifications are never copied in: an unresolved instrument stays
 * unresolved.
 */
export async function refreshSymbolMap(
  db: Admin,
  row: ConnectedAccountRow,
  platform: string,
): Promise<void> {
  const brokerSymbols = await fetchSymbols(row.metaapi_account_id!, row.region);
  if (brokerSymbols.length === 0) return;

  const mappings = mapSymbols(INSTRUMENTS as readonly string[], brokerSymbols);
  await db.from("connected_account_symbols" as never).upsert(
    mappings.map((m) => ({
      account_id: row.id,
      user_id: row.user_id,
      canonical_symbol: m.canonical,
      broker_symbol: m.brokerSymbol,
      mapping_kind: m.kind,
      candidates: m.candidates,
      resolved_at: new Date().toISOString(),
    })) as never,
    { onConflict: "account_id,canonical_symbol" },
  );

  for (const m of mappings) {
    if (!m.brokerSymbol) continue;
    const spec = await fetchTypedSymbolSpecification(
      row.metaapi_account_id!,
      row.region,
      m.brokerSymbol,
    ).catch(() => null);
    if (!spec) continue;
    const digits = Number.isFinite(Number(spec.digits)) ? Number(spec.digits) : null;
    const point = Number.isFinite(Number(spec.point))
      ? Number(spec.point)
      : digits !== null
        ? 10 ** -digits
        : null;
    await db.from("connected_account_specs" as never).upsert(
      {
        account_id: row.id,
        user_id: row.user_id,
        broker_symbol: m.brokerSymbol,
        canonical_symbol: m.canonical,
        contract_size: spec.contractSize ?? null,
        tick_size: spec.tickSize ?? null,
        point,
        point_source: Number.isFinite(Number(spec.point))
          ? "broker_point"
          : digits !== null
            ? "derived_from_digits"
            : null,
        digits,
        volume_min: spec.minVolume ?? null,
        volume_max: spec.maxVolume ?? null,
        volume_step: spec.volumeStep ?? null,
        volume_limit: spec.volumeLimit ?? null,
        stops_level: spec.stopsLevel ?? null,
        freeze_level: spec.freezeLevel ?? null,
        base_currency: spec.baseCurrency ?? null,
        profit_currency: spec.profitCurrency ?? null,
        raw: { ...spec, platform } as unknown,
        fetched_at: new Date().toISOString(),
      } as never,
      { onConflict: "account_id,broker_symbol" },
    );
  }
}

/**
 * Stop and remove a connection. The broker account itself is untouched and
 * everything already recorded in P-Trades is kept.
 */
export async function disconnectConnection(
  userId: string,
  accountId: string,
): Promise<{ summary: string }> {
  const db = await admin();
  const row = await ownedRow(userId, accountId);
  const plan = planDisconnect({ hasRemoteAccount: Boolean(row.metaapi_account_id) });

  if (plan.removeRemote && row.metaapi_account_id) {
    try {
      await undeployAccount(row.metaapi_account_id);
    } catch {
      // Already undeployed or unreachable — deletion below is the real stop.
    }
    try {
      await deleteAccount(row.metaapi_account_id);
    } catch (err) {
      const failure = classifyMetaApiFailure(err);
      await db
        .from(TABLE as never)
        .update({ last_error: failure.message } as never)
        .eq("id", row.id);
      throw new Error(
        `P-Trades could not remove this connection yet: ${failure.message} Nothing was changed.`,
      );
    }
  }

  const { error } = await db
    .from(TABLE as never)
    .update({
      disconnected_at: new Date().toISOString(),
      phase: "undeployed" satisfies AccountPhase,
      mode: "observe",
      metaapi_account_id: null,
      credentials_configured: false,
      last_error: null,
    } as never)
    .eq("id", row.id);
  if (error) throw new Error(error.message);

  return { summary: plan.summary };
}

/**
 * Resolve an `ambiguous` instrument by letting the owner pick the broker symbol.
 *
 * The choice is validated against the candidate list WE recorded from the
 * broker's own symbol list, so a client cannot introduce an arbitrary symbol.
 */
export async function chooseBrokerSymbol(
  userId: string,
  input: { accountId: string; canonicalSymbol: string; brokerSymbol: string },
): Promise<{ brokerSymbol: string }> {
  const db = await admin();
  const row = await ownedRow(userId, input.accountId);
  if (row.disconnected_at) throw new Error("This connection has been disconnected.");

  const { data, error } = await db
    .from("connected_account_symbols" as never)
    .select("candidates")
    .eq("account_id", row.id)
    .eq("canonical_symbol", input.canonicalSymbol)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const candidates = ((data as { candidates?: string[] } | null)?.candidates ?? []) as string[];
  if (!candidates.includes(input.brokerSymbol)) {
    throw new Error("That symbol is not one of the options your broker reported.");
  }

  const { error: updateError } = await db
    .from("connected_account_symbols" as never)
    .update({
      broker_symbol: input.brokerSymbol,
      mapping_kind: "suffix",
      resolved_at: new Date().toISOString(),
    } as never)
    .eq("account_id", row.id)
    .eq("canonical_symbol", input.canonicalSymbol);
  if (updateError) throw new Error(updateError.message);

  return { brokerSymbol: input.brokerSymbol };
}
