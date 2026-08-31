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
import { randomBytes, randomInt } from "node:crypto";

import {
  classifyAccountType,
  isMt5Netting,
  riskGuardianAvailability,
} from "@/lib/metaapi/classify";
import { readBenchmarkAccountId } from "@/lib/metaapi/config.server";
import { classifyMetaApiFailure } from "@/lib/metaapi/errors";
import { fetchAccountInformation } from "@/lib/metaapi/accounts.server";
import {
  createAccount,
  assertCanCreateAccounts,
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
import { isAccountMode, modeAfterReconcile } from "./mode";
import { mapSymbols } from "./symbol-map";
import type { ConnectedAccountRow } from "./types";

const TABLE = "connected_trading_accounts";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

async function admin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * True when a stored provider account id is the reserved P-Trades engine
 * account. Used for rows that ALREADY exist: they must never trigger a provider
 * mutation, but they must stay removable from the owner's profile.
 */
export function isReservedRemoteAccount(metaapiAccountId: string | null | undefined): boolean {
  if (!metaapiAccountId) return false;
  const benchmarkAccountId = readBenchmarkAccountId();
  return benchmarkAccountId?.toLowerCase() === metaapiAccountId.trim().toLowerCase();
}

/**
 * Never let a customer LINK or CREATE against the benchmark account.
 * This is an absolute refusal at the linking boundary only — removal of an
 * already-stored row is handled by `isReservedRemoteAccount`, so an owner can
 * never be trapped with an unusable connection slot.
 */
export function assertNotBenchmarkAccount(metaapiAccountId: string): void {
  if (isReservedRemoteAccount(metaapiAccountId)) {
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
  /** TRUE when MetaApi accepted creation but has not returned the account yet. */
  provisioningPending: boolean;
}

function createInput(
  label: string,
  platform: MetaApiPlatform,
  server: string,
  region: string,
  magic: number,
): Parameters<typeof createAccount>[0] {
  return {
    name: `P-Trades ${label}`,
    platform,
    server,
    region,
    magic,
    // Increased Reliability, MetaStats and Risk Management are separately
    // billed. Ordinary provisioning never opts the operator into them.
    reliability: "regular",
    // MetaApi's `manualTrades` describes orders placed THROUGH MetaApi. It does
    // not disable the owner's own MT terminal trading. Keep it false so broker
    // orders carry this connection's positive magic tag; MetaApi requires
    // magic=0 when `manualTrades` is true.
    manualTrades: false,
    metastatsApiEnabled: false,
    riskManagementApiEnabled: false,
    draft: true,
  };
}

function creationMayBePending(kind: ReturnType<typeof classifyMetaApiFailure>["kind"]): boolean {
  return ["processing", "timeout", "unreachable", "rate_limited", "server"].includes(kind);
}

/**
 * Positive MT order tag assigned once per connection. The database unique index
 * is the final collision guard; the two-billion-value space makes a collision
 * vanishingly unlikely before that guard is reached.
 */
export function newAccountOrderTag(): number {
  return randomInt(1_000_000, 2_000_000_000);
}

/** 128 bits of entropy encoded directly as MetaApi's required 32 hex characters. */
export function newProvisionTransactionId(): string {
  return randomBytes(16).toString("hex");
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
export async function startConnection(input: StartConnectionInput): Promise<StartConnectionResult> {
  const label = cleanLabel(input.label);
  const server = cleanServer(input.brokerServer);
  if (!isOfferedRegion(input.region)) throw new Error("Choose one of the offered regions.");
  if (input.platform !== "mt4" && input.platform !== "mt5") {
    throw new Error("Choose MT4 or MT5.");
  }

  // Run the deterministic token-scope check before reserving quota. Otherwise
  // a token which can never create accounts leaves behind a FAILED local row
  // and consumes a connection slot without contacting the provider.
  assertCanCreateAccounts();
  const db = await admin();

  // MetaApi documents a random 32-character transaction id. Persist it before
  // the request and reuse it for every continuation of this one attempt.
  const transactionId = newProvisionTransactionId();
  const magic = newAccountOrderTag();

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
      magic,
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
      createInput(label, input.platform, server, input.region, magic),
      transactionId,
    );
    assertNotBenchmarkAccount(created.id);

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
      provisioningPending: false,
    };
  } catch (err) {
    const failure = classifyMetaApiFailure(err);
    if (creationMayBePending(failure.kind)) {
      await db
        .from(TABLE as never)
        .update({ phase: "created" satisfies AccountPhase, last_error: failure.message } as never)
        .eq("id", rowId);
      return {
        accountId: rowId,
        configurationUrl: null,
        configurationExpiresAt: null,
        provisioningPending: true,
      };
    }
    await db
      .from(TABLE as never)
      .update({ phase: "failed" satisfies AccountPhase, last_error: failure.message } as never)
      .eq("id", rowId);
    throw new Error(failure.message);
  }
}

export interface AdoptConnectionInput {
  userId: string;
  label: string;
  /** Provider account id the owner already has provisioned. */
  metaapiAccountId: string;
  intent: ConnectionIntent;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Link a trading account that ALREADY exists at the provider, without calling
 * creation at all. This is the only path available when the configured access
 * token is scoped to specific accounts.
 *
 * Order of refusals matters: the benchmark guard and the duplicate check run
 * before any database write, and the provider's own record — not the caller — is
 * the authority on platform, server and region.
 */
export async function adoptConnection(input: AdoptConnectionInput): Promise<{ accountId: string }> {
  const label = cleanLabel(input.label);
  const metaapiAccountId = input.metaapiAccountId.trim().toLowerCase();
  if (!UUID_RE.test(metaapiAccountId)) {
    throw new Error(
      "That does not look like a trading account id. Copy the account id from your broker-connection provider's MT Accounts page.",
    );
  }
  if (input.intent !== "demo" && input.intent !== "live") {
    throw new Error("Choose whether this is a demo or a live account.");
  }
  // Reserved engine account: linking it would pool research results into a
  // customer journal and corrupt performance statistics.
  assertNotBenchmarkAccount(metaapiAccountId);
  const db = await admin();

  const { data: existing, error: existingError } = await db
    .from(TABLE as never)
    .select("id, disconnected_at")
    .eq("metaapi_account_id", metaapiAccountId)
    .is("disconnected_at", null)
    .limit(1);
  if (existingError) throw new Error(existingError.message);
  if (existing && existing.length > 0) {
    throw new Error("That trading account is already linked to a P-Trades connection.");
  }

  let remote: Awaited<ReturnType<typeof fetchProvisionedAccount>>;
  try {
    remote = await fetchProvisionedAccount(metaapiAccountId);
  } catch (err) {
    throw new Error(classifyMetaApiFailure(err).message);
  }
  if (!remote) {
    throw new Error(
      "Your broker-connection provider has no account with that id, or your access token cannot read it.",
    );
  }

  const platform = remote.platform === "mt4" || remote.platform === "mt5" ? remote.platform : null;
  if (!platform) {
    throw new Error(
      "Your broker-connection provider did not report whether that account is MT4 or MT5, so it cannot be linked yet.",
    );
  }
  const region = (remote.region ?? "").toString();
  if (!isOfferedRegion(region)) {
    throw new Error(
      `That account runs in the ${region || "unknown"} region, which P-Trades does not offer. Link an account provisioned in one of the offered regions.`,
    );
  }
  const server = remote.server ? cleanServer(remote.server.toString()) : null;
  if (!server) {
    throw new Error(
      "Your broker-connection provider did not report a broker server for that account, so it cannot be linked yet.",
    );
  }

  const { data: inserted, error: insertError } = await db
    .from(TABLE as never)
    .insert({
      user_id: input.userId,
      // This id is not sent during adoption, but keep the persisted invariant
      // identical for every connected-account row.
      provision_transaction_id: newProvisionTransactionId(),
      label,
      platform,
      broker_server: server,
      region,
      intent: input.intent,
      magic: newAccountOrderTag(),
      metaapi_account_id: metaapiAccountId,
      provisioning_state: remote.state ?? null,
      connection_status: remote.connectionStatus ?? null,
      credentials_configured: remote.login !== null && remote.login !== undefined,
      // Adoption never shortcuts verification: the normal reconcile ladder
      // decides DEPLOYED → CONNECTED → verified → READY, and the mode stays in
      // observe until the owner arms it.
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
    if (insertError.message.includes("duplicate")) {
      throw new Error("That trading account is already linked to a P-Trades connection.");
    }
    throw new Error(insertError.message);
  }

  const rowId = (inserted as { id: string }).id;
  // Push it forward once so the card does not open on a stale phase.
  try {
    await reconcileConnection(input.userId, rowId);
  } catch {
    // Reconcile records its own failure on the row; linking itself succeeded.
  }
  return { accountId: rowId };
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
  // NOTE: a stored reserved id is deliberately NOT refused here. Callers that
  // would mutate the provider check `isReservedRemoteAccount` themselves, so
  // the owner can always disconnect and free the slot.
  return data as unknown as ConnectedAccountRow;
}

/** Re-issue the hosted credential page for a connection that is still waiting. */
export async function reissueConfigurationLink(
  userId: string,
  accountId: string,
): Promise<{ configurationUrl: string; expiresAt: string }> {
  const row = await ownedRow(userId, accountId);
  if (row.disconnected_at) throw new Error("This connection has been disconnected.");
  if (isReservedRemoteAccount(row.metaapi_account_id)) {
    throw new Error(
      "This connection points at a trading account reserved by P-Trades, so no secure login page can be issued for it. Disconnect it and connect your own account instead.",
    );
  }
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
  if (isReservedRemoteAccount(row.metaapi_account_id)) {
    return await writeAndReturn(db, row.id, {
      phase: "failed" satisfies AccountPhase,
      last_error:
        "This connection points at a trading account reserved by P-Trades, so it can never be used for your own trading. Disconnect it and connect your own account instead.",
      last_reconciled_at: new Date().toISOString(),
    });
  }
  if (!row.metaapi_account_id) {
    if (row.phase !== "created" || !row.broker_server) return row;
    if (!Number.isInteger(row.magic) || (row.magic ?? 0) <= 0) {
      return await writeAndReturn(db, row.id, {
        phase: "failed" satisfies AccountPhase,
        last_error:
          "This connection has no order tag, so P-Trades stopped before continuing. Disconnect it and create it again.",
        last_reconciled_at: new Date().toISOString(),
      });
    }
    try {
      const created = await createAccount(
        createInput(row.label, row.platform, row.broker_server, row.region, row.magic as number),
        row.provision_transaction_id,
      );
      assertNotBenchmarkAccount(created.id);
      return await writeAndReturn(db, row.id, {
        metaapi_account_id: created.id,
        provisioning_state: created.state,
        phase: "awaiting_credentials" satisfies AccountPhase,
        last_error: null,
        last_reconciled_at: new Date().toISOString(),
      });
    } catch (err) {
      const failure = classifyMetaApiFailure(err);
      return await writeAndReturn(db, row.id, {
        phase: creationMayBePending(failure.kind)
          ? ("created" satisfies AccountPhase)
          : ("failed" satisfies AccountPhase),
        last_error: failure.message,
        last_reconciled_at: new Date().toISOString(),
      });
    }
  }

  const patch: Record<string, unknown> = { last_reconciled_at: new Date().toISOString() };

  try {
    const remote = await fetchProvisionedAccount(row.metaapi_account_id);
    if (!remote)
      throw new Error("Your broker-connection provider has no record of this connection.");

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
  remote: {
    metastatsApiEnabled?: boolean | null;
    riskManagementApiEnabled?: boolean | null;
    reliability?: string | null;
  },
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
    await db.from("connected_account_specs" as never).upsert(
      buildAccountSpecRow({
        accountId: row.id,
        userId: row.user_id,
        brokerSymbol: m.brokerSymbol,
        canonicalSymbol: m.canonical,
        platform,
        spec,
        fetchedAt: new Date().toISOString(),
      }) as never,
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
  force = false,
): Promise<{ summary: string }> {
  const db = await admin();
  const row = await ownedRow(userId, accountId);
  const reservedRemote = isReservedRemoteAccount(row.metaapi_account_id);
  const plan = planDisconnect({
    hasRemoteAccount: Boolean(row.metaapi_account_id),
    reservedRemote,
    force,
  });

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
        `P-Trades could not remove this connection at your broker-connection provider: ${failure.message} Nothing was changed yet — you can disconnect anyway to free the slot on the P-Trades side.`,
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
