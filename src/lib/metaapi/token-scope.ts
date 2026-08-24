/**
 * Read-only inspection of the configured provider access token's own claims.
 *
 * Why this exists: a provider token can be generated *per trading account*, in
 * which case every access rule carries a `resources` restriction pinned to that
 * one account id. Such a token can read and trade that account perfectly well,
 * but it can never create a NEW account, because `createAccount` is not an
 * operation on an existing resource. Without this pre-flight the wizard only
 * learns that from an opaque provider 403.
 *
 * SECURITY: the payload is decoded for *diagnostics only*. The signature is not
 * verified and nothing here grants access; the provider remains the sole
 * authority on what the token may do. No token text is ever returned or logged.
 * Pure module: no fetch, no env, no clock.
 */

export interface MetaApiAccessRule {
  id: string;
  methods: string[];
  roles: string[];
  /** Empty when the rule applies to every resource in the account. */
  resources: string[];
}

/** The provider service that owns `createAccount`. */
export const ACCOUNT_MANAGEMENT_RULE_ID = "trading-account-management-api";

function base64UrlDecode(segment: string): string | null {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    return atob(padded + pad);
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Decode the token's `accessRules`. Returns NULL when the token is not a
 * readable JWT or carries no rules — never throws, never partially guesses.
 */
export function decodeAccessRules(token: string): MetaApiAccessRule[] | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const json = base64UrlDecode(parts[1] ?? "");
  if (!json) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as { accessRules?: unknown }).accessRules;
  if (!Array.isArray(raw)) return null;
  const rules: MetaApiAccessRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    rules.push({
      id,
      methods: stringArray((entry as { methods?: unknown }).methods),
      roles: stringArray((entry as { roles?: unknown }).roles),
      resources: stringArray((entry as { resources?: unknown }).resources),
    });
  }
  return rules;
}

/**
 * A resource entry restricts the rule unless it is a pure wildcard. Provider
 * resource strings look like `*:$USER_ID$:<accountId>` (restricted) or
 * `*:$USER_ID$:*` / `*` (unrestricted).
 */
function restrictsResources(resources: string[]): boolean {
  if (resources.length === 0) return false;
  return !resources.some((r) => {
    const trimmed = r.trim();
    if (trimmed === "" || trimmed === "*") return true;
    const last = trimmed.split(":").pop() ?? "";
    return last === "*";
  });
}

export type CreateAccountScope =
  | { allowed: true }
  | { allowed: false; reason: "unreadable" | "missing_rule" | "read_only" | "account_restricted" };

/**
 * Can the configured token provision a NEW trading account?
 *
 * `unreadable` is treated as permissive-with-a-flag by callers: we do not block
 * a request just because we could not parse the token, the provider decides.
 */
export function inspectCreateAccountScope(token: string): CreateAccountScope {
  const rules = decodeAccessRules(token);
  if (!rules) return { allowed: false, reason: "unreadable" };
  const managementRules = rules.filter((r) => r.id === ACCOUNT_MANAGEMENT_RULE_ID);
  if (managementRules.length === 0) return { allowed: false, reason: "missing_rule" };

  // A token can contain more than one rule for the same API. Access is the
  // union of those rules: one unrestricted writer is sufficient even when an
  // earlier rule is read-only or account-scoped. Looking at only the first rule
  // would falsely reject a valid operator token.
  const writerRules = managementRules.filter((rule) => rule.roles.includes("writer"));
  if (writerRules.length === 0) return { allowed: false, reason: "read_only" };
  if (writerRules.every((rule) => restrictsResources(rule.resources))) {
    return { allowed: false, reason: "account_restricted" };
  }
  return { allowed: true };
}

/** Operator-facing sentence for each refusal reason. Never includes the token. */
export function describeCreateAccountScope(
  reason: Exclude<CreateAccountScope, { allowed: true }>["reason"],
): string {
  switch (reason) {
    case "missing_rule":
      return "The access token P-Trades is configured with does not include the trading account management API, so it cannot create a new broker connection. Generate a token with that API enabled. Nothing was created or charged.";
    case "read_only":
      return "The access token P-Trades is configured with has read-only access to the trading account management API, so it cannot create a new broker connection. Generate a token with read-write access. Nothing was created or charged.";
    case "account_restricted":
      return "The access token P-Trades is configured with is restricted to specific trading accounts, so it cannot provision a new one. Generate a token without a resource restriction, or link an account you already have instead. Nothing was created or charged.";
    case "unreadable":
      return "The access token P-Trades is configured with could not be read.";
  }
}
