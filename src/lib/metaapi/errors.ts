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
  | "auth"
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
  if (err instanceof MetaApiNotConfiguredError) {
    return {
      kind: "not_configured",
      message: err.message,
      status: null,
      retryAfterSeconds: null,
      retryable: false,
    };
  }
  if (err instanceof MetaApiHttpError) {
    const body = err.body.toLowerCase();
    const billing = /top up|topup|payment|billing|insufficient funds/.test(body);
    const disabled = /not enabled|not activated/.test(body);
    if (err.status === 401 || err.status === 403) {
      return {
        kind: billing ? "provider_billing" : disabled ? "feature_not_enabled" : "auth",
        message: err.message,
        status: err.status,
        retryAfterSeconds: err.retryAfterSeconds,
        retryable: false,
      };
    }
    if (err.status === 400) {
      return {
        kind: billing ? "provider_billing" : "validation",
        message: err.message,
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
