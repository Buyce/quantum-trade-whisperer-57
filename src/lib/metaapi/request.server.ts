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
import { METAAPI_APPLICATION, REQUEST_TIMEOUT_MS, readMetaApiToken } from "./config.server";
import { MetaApiHttpError, MetaApiNotConfiguredError, MetaApiTimeoutError } from "./errors";
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

function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Perform a MetaApi call and return the parsed JSON body (or `null` for an
 * empty body). Throws `MetaApiTimeoutError`, `MetaApiNotConfiguredError` or
 * `MetaApiHttpError` — nothing else escapes.
 */
export async function metaApiRequest<T = unknown>(
  options: MetaApiRequestOptions,
): Promise<T | null> {
  const token = readMetaApiToken();
  const host = resolveHost(options.service, options.region ?? null);
  if (!host) {
    throw new MetaApiNotConfiguredError(
      `a trusted MetaApi ${options.service} host for region "${options.region ?? ""}"`,
    );
  }

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
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
