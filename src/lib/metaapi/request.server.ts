/**
 * The ONE outbound MetaApi request path.
 *
 * Responsibilities, deliberately centralised so no call site can skip them:
 *  - resolve a TRUSTED host from a validated region (never a supplied hostname)
 *  - inject the auth token and application header (never logged)
 *  - hard-abort after 8s so MT's known missing-data hang cannot stall a worker
 *  - map every failure into the single error vocabulary in `errors.ts`
 *  - preserve `retry-after` so 202/429 handling can be honest about waiting
 */
import { METAAPI_APPLICATION, REQUEST_TIMEOUT_MS, readMetaApiTokens } from "./config.server";
import {
  MetaApiHttpError,
  MetaApiNotConfiguredError,
  MetaApiTimeoutError,
  MetaApiUnreachableError,
} from "./errors";
import { resolveHost, type MetaApiService } from "./hosts";

export interface MetaApiRequestOptions {
  service: MetaApiService;
  /** Required for regional services; ignored for global ones. */
  region?: string | null;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Short, non-sensitive label used in error messages. */
  label: string;
  /** Extra headers (e.g. `transaction-id` for idempotent provisioning). */
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Treat a 202 (MetaStats still processing) as an error the caller handles. */
  throwOn202?: boolean;
}

/** One bounded retry for idempotent reads after a transient vendor gateway response. */
export const SAFE_GET_RETRY_DELAY_MS = 250;
const TRANSIENT_READ_STATUSES = new Set([502, 503, 504]);

export function parseRetryAfterSeconds(raw: string | null, nowMs = Date.now()): number | null {
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;

  // MetaApi also sends the HTTP-date form. Preserve it as a delay instead of
  // silently discarding the provider's polling instruction.
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1_000));
}

function retryAfterSeconds(res: Response): number | null {
  return parseRetryAfterSeconds(res.headers.get("retry-after"));
}

/**
 * Perform a MetaApi call and return the parsed JSON body (or `null` for an
 * empty body). Throws `MetaApiTimeoutError`, `MetaApiNotConfiguredError` or
 * `MetaApiHttpError` — nothing else escapes.
 */
async function requestOnce<T>(
  options: MetaApiRequestOptions,
  host: string,
  token: string,
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${host}${options.path}`, {
      method: options.method ?? "GET",
      headers: {
        "auth-token": token,
        "Content-Type": "application/json",
        application: METAAPI_APPLICATION,
        ...(options.headers ?? {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });

    if (res.status === 202 && options.throwOn202) {
      throw new MetaApiHttpError(
        202,
        options.label,
        "MetaApi is still processing this request",
        retryAfterSeconds(res),
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 520-530 come from the vendor's edge rather than a normal API response.
      // The edge did not confirm application-level processing. Callers must
      // preserve their idempotency key because an ambiguous failure must never
      // be treated as proof that a mutation did not reach the origin.
      if (res.status >= 520 && res.status <= 530) {
        throw new MetaApiUnreachableError(
          options.label,
          `HTTP ${res.status} ${body.slice(0, 120)}`,
        );
      }
      throw new MetaApiHttpError(res.status, options.label, body, retryAfterSeconds(res));
    }

    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new MetaApiHttpError(res.status, options.label, "response body was not valid JSON");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MetaApiTimeoutError(options.label);
    }
    // A DNS/TLS/socket failure surfaces as a TypeError from fetch. Nothing was
    // sent, so it is reported as unreachable rather than as vendor prose.
    if (err instanceof TypeError) {
      throw new MetaApiUnreachableError(options.label, err.message);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Perform a MetaApi call through the ordered server-token candidates.
 *
 * Safety invariants:
 *  - an alternate token is tried only after an explicit 401/403 rejection;
 *  - a transient 502/503/504 is retried only for GET, once, with the same token;
 *  - mutations are never retried after an ambiguous timeout or 5xx response.
 */
export async function metaApiRequest<T = unknown>(
  options: MetaApiRequestOptions,
): Promise<T | null> {
  const purpose = options.service === "provisioning" ? "provisioning" : "general";
  const tokens = readMetaApiTokens(purpose);
  const host = resolveHost(options.service, options.region ?? null);
  if (!host) {
    throw new MetaApiNotConfiguredError(
      `a trusted MetaApi ${options.service} host for region "${options.region ?? ""}"`,
    );
  }

  const method = options.method ?? "GET";
  let lastAuthError: MetaApiHttpError | null = null;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]!;
    const attempts = method === "GET" ? 2 : 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await requestOnce<T>(options, host, token);
      } catch (err) {
        const transientRead =
          method === "GET" &&
          err instanceof MetaApiHttpError &&
          TRANSIENT_READ_STATUSES.has(err.status);
        if (transientRead && attempt + 1 < attempts) {
          await new Promise((resolve) => setTimeout(resolve, SAFE_GET_RETRY_DELAY_MS));
          continue;
        }

        const rejectedToken =
          err instanceof MetaApiHttpError && (err.status === 401 || err.status === 403);
        if (rejectedToken && tokenIndex + 1 < tokens.length) {
          // An authorization rejection confirms this credential did not permit
          // the operation. Trying the alternate token cannot duplicate it.
          lastAuthError = err;
          break;
        }
        throw err;
      }
    }
  }

  // Every successful branch returned and every terminal failure threw. This is
  // only reachable when the first token was rejected and no candidate remained.
  throw lastAuthError ?? new MetaApiNotConfiguredError("a usable MetaApi access token");
}
