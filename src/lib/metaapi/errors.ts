/**
 * The ONE MetaApi error vocabulary and mapper.
 *
 * Every module under `src/lib/metaapi/` throws these and nothing else, so a
 * caller can decide "skip this cycle", "fail closed" or "record unknown"
 * without string-matching vendor prose. Pure: no fetch, no env, no clock.
 */

/** Kept in sync with `REQUEST_TIMEOUT_MS`; used for message text only. */
export const TIMEOUT_HINT_MS = 8_000;

/** Timed out and aborted locally. The request may still have reached MetaApi. */
export class MetaApiTimeoutError extends Error {
  readonly label: string;
  constructor(label: string, detail = "") {
    super(
      `MetaApi request for ${label}${detail ? ` ${detail}` : ""} exceeded ${TIMEOUT_HINT_MS}ms and was aborted`,
    );
    this.name = "MetaApiTimeoutError";
    this.label = label;
  }
}

/** Server-side configuration is missing. Never a transient condition. */
export class MetaApiNotConfiguredError extends Error {
  constructor(what = "METAAPI_TOKEN") {
    super(`${what} is not configured`);
    this.name = "MetaApiNotConfiguredError";
  }
}

/**
 * The provider host could not be reached at all: DNS failure, TLS failure, or
 * the vendor edge answering with its own "origin unavailable" page (HTTP 530,
 * error code 1016). There is no application-level confirmation either way.
 */
export class MetaApiUnreachableError extends Error {
  readonly label: string;
  readonly detail: string;
  constructor(label: string, detail: string) {
    super(
      `P-Trades could not reach your broker-connection provider for ${label}, so it could not confirm whether the request was processed. P-Trades will reuse the same idempotency key for a safe retry when that operation supports one. Technical detail: ${detail.slice(0, 200)}`,
    );
    this.name = "MetaApiUnreachableError";
    this.label = label;
    this.detail = detail.slice(0, 200);
  }
}

/**
 * The configured access token's own claims show it cannot perform the requested
 * operation — typically a token generated for ONE trading account being asked to
 * provision a new one. Raised before any request leaves P-Trades, so nothing was
 * created, changed or charged.
 */
export class MetaApiTokenScopeError extends Error {
  readonly label: string;
  constructor(label: string, message: string) {
    super(message);
    this.name = "MetaApiTokenScopeError";
    this.label = label;
  }
}

/** A non-2xx MetaApi response. `body` is truncated and never logged wholesale. */
export class MetaApiHttpError extends Error {
  readonly status: number;
  readonly label: string;
  readonly body: string;
  /** Seconds from a `retry-after` header, when MetaApi sent one. */
  readonly retryAfterSeconds: number | null;
  constructor(
    status: number,
    label: string,
    body: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(`MetaApi ${status} for ${label}: ${body.slice(0, 300)}`);
    this.name = "MetaApiHttpError";
    this.status = status;
    this.label = label;
    this.body = body.slice(0, 300);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type MetaApiFailureKind =
  | "timeout"
  | "not_configured"
  | "unreachable"
  | "auth"
  | "permission"
  | "not_found"
  | "feature_not_enabled"
  | "provider_billing"
  | "rate_limited"
  | "processing"
  | "validation"
  | "server"
  | "unknown";

export interface MetaApiFailure {
  kind: MetaApiFailureKind;
  /** Safe, operator-facing sentence. Never contains tokens or credentials. */
  message: string;
  status: number | null;
  retryAfterSeconds: number | null;
  /** TRUE only when re-issuing the identical request is safe and useful. */
  retryable: boolean;
}

/**
 * Classify any thrown value into one bounded shape. A billing refusal is
 * deliberately its own kind: it means data is MISSING, never that a scan or a
 * broker check produced a negative answer.
 */
export function classifyMetaApiFailure(err: unknown): MetaApiFailure {
  if (err instanceof MetaApiTimeoutError) {
    return {
      kind: "timeout",
      message: err.message,
      status: null,
      retryAfterSeconds: null,
      retryable: false,
    };
  }
  if (err instanceof MetaApiTokenScopeError) {
    return {
      kind: "permission",
      message: err.message,
      status: null,
      retryAfterSeconds: null,
      retryable: false,
    };
  }
  if (err instanceof MetaApiNotConfiguredError) {
    return {
      kind: "not_configured",
      message: err.message,
      status: null,
      retryAfterSeconds: null,
      retryable: false,
    };
  }
  if (err instanceof MetaApiUnreachableError) {
    return {
      kind: "unreachable",
      message: err.message,
      status: null,
      retryAfterSeconds: null,
      retryable: true,
    };
  }
  if (err instanceof MetaApiHttpError) {
    const body = err.body.toLowerCase();
    const billing = /top up|topup|payment|billing|insufficient funds/.test(body);
    const disabled = /not enabled|not activated/.test(body);
    if (err.status === 401 || err.status === 403) {
      // A 403 that names a `methodId` / ForbiddenError is the provider saying the
      // configured access token is not permitted to call that method at all. It is
      // a configuration gap, not a bad credential and not a broker rejection, so
      // it gets its own kind and a plain sentence instead of vendor JSON.
      const scoped = /forbiddenerror|methodid|do not have access to/.test(body);
      if (!billing && !disabled && scoped) {
        // A refusal that names `createAccount` is almost always a token generated
        // for ONE trading account: it has the account-management API but every
        // rule is pinned to an existing account id, and creation is not an
        // operation on an existing account.
        const creation = /createaccount/.test(body);
        const accountRead = err.label === "read account";
        return {
          kind: "permission",
          message: accountRead
            ? "P-Trades has a broker-connection account id, but neither usable server token is allowed to read that account. The provider account may already exist and may consume provider resources. Configure an unrestricted reader-and-writer token for the trading account management API, publish the secret change, then Refresh this connection; do not create another connection."
            : creation
              ? `Your broker-connection provider refused ${err.label} because the server token is not allowed to create trading accounts. Generate a token that includes the trading account management API with reader and writer roles and no resource restriction, or link an account you already have instead. Nothing was created, changed or charged.`
              : `Your broker-connection provider refused ${err.label} because the configured server token(s) do not have the matching permission. No successful change was confirmed.`,
          status: err.status,
          retryAfterSeconds: err.retryAfterSeconds,
          retryable: false,
        };
      }
      return {
        kind: billing ? "provider_billing" : disabled ? "feature_not_enabled" : "auth",
        message:
          billing || disabled
            ? err.message
            : `Your broker-connection provider rejected P-Trades authentication for ${err.label}. Check that the applicable server token is valid, published to the live app and permitted to access this account.`,
        status: err.status,
        retryAfterSeconds: err.retryAfterSeconds,
        retryable: false,
      };
    }
    if (err.status === 400) {
      // A ValidationError names the exact field it objected to. Surfacing that
      // field turns raw vendor JSON into a sentence an operator can act on, and
      // makes "we sent something the provider does not accept" unmistakable.
      const parameter = /"parameter"\s*:\s*"([a-z0-9_]+)"/i.exec(err.body)?.[1] ?? null;
      return {
        kind: billing ? "provider_billing" : "validation",
        message:
          !billing && parameter
            ? `Your broker-connection provider rejected ${err.label} because P-Trades sent a value it does not accept for "${parameter}". Nothing was created, changed or charged. Technical detail: ${err.body}`
            : err.message,
        status: 400,
        retryAfterSeconds: null,
        retryable: false,
      };
    }

    if (err.status === 404) {
      return {
        kind: "not_found",
        message: err.message,
        status: 404,
        retryAfterSeconds: null,
        retryable: false,
      };
    }
    if (err.status === 202) {
      return {
        kind: "processing",
        message: err.message,
        status: 202,
        retryAfterSeconds: err.retryAfterSeconds,
        retryable: true,
      };
    }
    if (err.status === 429) {
      return {
        kind: "rate_limited",
        message: err.message,
        status: 429,
        retryAfterSeconds: err.retryAfterSeconds,
        retryable: true,
      };
    }
    if (err.status >= 500) {
      return {
        kind: "server",
        message: err.message,
        status: err.status,
        retryAfterSeconds: err.retryAfterSeconds,
        retryable: true,
      };
    }
    return {
      kind: "unknown",
      message: err.message,
      status: err.status,
      retryAfterSeconds: err.retryAfterSeconds,
      retryable: false,
    };
  }
  return {
    kind: "unknown",
    message: err instanceof Error ? err.message : String(err),
    status: null,
    retryAfterSeconds: null,
    retryable: false,
  };
}

/**
 * A scanner GET can safely defer these failures to its next cycle. They are
 * provider/network availability failures, not evidence that a symbol is absent.
 */
export function isTransientMetaApiReadFailure(err: unknown): boolean {
  return (
    err instanceof MetaApiTimeoutError ||
    err instanceof MetaApiUnreachableError ||
    (err instanceof MetaApiHttpError && [502, 503, 504].includes(err.status))
  );
}
