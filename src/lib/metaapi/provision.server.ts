/**
 * Provisioning API: create, read, deploy and remove MetaApi accounts.
 *
 * Two rules matter here:
 *  1. Creation is IDEMPOTENT. Every create carries a caller-supplied
 *     `transaction-id`, so a retry after a timeout cannot mint a second paid
 *     account for the same connection attempt.
 *  2. Credentials never touch our database. When the account is created through
 *     a configuration link, the broker login/password are entered on MetaApi's
 *     own hosted page; we only ever store the returned account id.
 */
import { readMetaApiToken } from "./config.server";
import { MetaApiTokenScopeError } from "./errors";
import { metaApiRequest } from "./request.server";
import { describeCreateAccountScope, inspectCreateAccountScope } from "./token-scope";
import type { MetaApiPlatform, ProvisionedAccount } from "./types";

const PROVISIONING = { service: "provisioning" as const, region: null };

/**
 * Refuse a creation attempt the configured token demonstrably cannot perform,
 * BEFORE any request leaves P-Trades. An unreadable token is never blocked here:
 * the provider stays the authority, this only turns a knowable configuration gap
 * into a sentence the account owner can act on.
 */
function assertCanCreateAccounts(): void {
  const scope = inspectCreateAccountScope(readMetaApiToken("provisioning"));
  if (scope.allowed || scope.reason === "unreadable") return;
  throw new MetaApiTokenScopeError("create account", describeCreateAccountScope(scope.reason));
}

export interface CreateAccountInput {
  name: string;
  platform: MetaApiPlatform;
  /** Broker server name exactly as the broker publishes it. */
  server?: string;
  login?: string;
  password?: string;
  region: string;
  /** `high` keeps a hot standby; used for accounts that place orders. */
  reliability?: "regular" | "high";
  magic: number;
  /** Allow the human account owner to trade manually alongside P-Trades. */
  manualTrades?: boolean;
  metastatsApiEnabled?: boolean;
  riskManagementApiEnabled?: boolean;
  /** Create without credentials, to be completed via a configuration link. */
  draft?: boolean;
}

/**
 * Create (or return the existing) MetaApi account for `transactionId`.
 * The same `transactionId` MUST be reused on every retry of one attempt.
 */
export async function createAccount(
  input: CreateAccountInput,
  transactionId: string,
): Promise<{ id: string; state: string | null }> {
  assertCanCreateAccounts();
  const body: Record<string, unknown> = {
    name: input.name,
    type: "cloud-g2",
    platform: input.platform,
    region: input.region,
    magic: input.magic,
    reliability: input.reliability ?? "high",
    manualTrades: input.manualTrades ?? true,
    metastatsApiEnabled: input.metastatsApiEnabled ?? true,
    riskManagementApiEnabled: input.riskManagementApiEnabled ?? true,
    ...(input.server ? { server: input.server } : {}),
    ...(input.login ? { login: input.login } : {}),
    ...(input.password ? { password: input.password } : {}),
    // NOTE: `state` is NOT a create-account parameter — sending it is rejected
    // with a 400 ValidationError. A draft is produced by omitting the broker
    // credentials; the provider then returns state DRAFT itself.

  };

  const res = await metaApiRequest<{ id?: string; state?: string }>({
    ...PROVISIONING,
    method: "POST",
    label: "create account",
    path: "/users/current/accounts",
    headers: { "transaction-id": transactionId },
    body,
  });
  if (!res?.id) throw new Error("MetaApi did not return an account id for this creation attempt");
  return { id: res.id, state: res.state ?? null };
}

export async function fetchProvisionedAccount(accountId: string): Promise<ProvisionedAccount | null> {
  return await metaApiRequest<ProvisionedAccount>({
    ...PROVISIONING,
    label: "read account",
    path: `/users/current/accounts/${accountId}`,
  });
}

export interface ConfigurationLink {
  url: string;
  /** Link lifetime in days, as requested (MetaApi's own unit for this call). */
  ttlDays: number;
  expiresAt: string;
}

/** MetaApi's documented default TTL for configuration links. */
export const CONFIGURATION_LINK_DEFAULT_TTL_DAYS = 7;

/**
 * A hosted page where the account owner enters their broker credentials.
 * We never see, transmit or store the password.
 */
export async function createConfigurationLink(
  accountId: string,
  ttlDays = CONFIGURATION_LINK_DEFAULT_TTL_DAYS,
): Promise<ConfigurationLink | null> {
  const res = await metaApiRequest<{ configurationLink?: string }>({
    ...PROVISIONING,
    method: "PUT",
    label: "configuration link",
    path: `/users/current/accounts/${accountId}/configuration-link?ttlInDays=${ttlDays}`,
  });
  if (!res?.configurationLink) return null;
  return {
    url: res.configurationLink,
    ttlDays,
    expiresAt: new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
  };
}


export async function deployAccount(accountId: string): Promise<void> {
  await metaApiRequest({
    ...PROVISIONING,
    method: "POST",
    label: "deploy account",
    path: `/users/current/accounts/${accountId}/deploy`,
  });
}

export async function undeployAccount(accountId: string): Promise<void> {
  await metaApiRequest({
    ...PROVISIONING,
    method: "POST",
    label: "undeploy account",
    path: `/users/current/accounts/${accountId}/undeploy`,
  });
}

export async function redeployAccount(accountId: string): Promise<void> {
  await metaApiRequest({
    ...PROVISIONING,
    method: "POST",
    label: "redeploy account",
    path: `/users/current/accounts/${accountId}/redeploy`,
  });
}

export async function deleteAccount(accountId: string): Promise<void> {
  await metaApiRequest({
    ...PROVISIONING,
    method: "DELETE",
    label: "delete account",
    path: `/users/current/accounts/${accountId}`,
  });
}
