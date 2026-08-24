import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiHttpError, MetaApiNotConfiguredError, MetaApiTimeoutError } from "../errors";
import { metaApiRequest, parseRetryAfterSeconds } from "../request.server";

const ORIGINAL_FETCH = globalThis.fetch;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

describe("metaApiRequest", () => {
  beforeEach(() => {
    process.env["METAAPI_TOKEN"] = "test-token";
    delete process.env["METAAPI_PROVISIONING_TOKEN"];
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("[UNIT] calls the trusted regional host with auth and application headers", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await metaApiRequest<{ ok: boolean }>({
      service: "client",
      region: "london",
      path: "/x",
      label: "x",
    });

    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mt-client-api-v1.london.agiliumtrade.ai/x");
    const headers = init.headers as Record<string, string>;
    expect(headers["auth-token"]).toBe("test-token");
    expect(headers["application"]).toBe("MetaApi");
  });

  it("[INVARIANT] refuses to send anything when the region cannot be trusted", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      metaApiRequest({ service: "client", region: "evil.example.com", path: "/x", label: "x" }),
    ).rejects.toBeInstanceOf(MetaApiNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[INVARIANT] refuses to send anything when the token is not configured", async () => {
    delete process.env["METAAPI_TOKEN"];
    delete process.env["METAAPI_PROVISIONING_TOKEN"];
    const fetchMock = vi.fn(async () => jsonResponse({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      metaApiRequest({ service: "provisioning", path: "/x", label: "x" }),
    ).rejects.toBeInstanceOf(MetaApiNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[INVARIANT] an aborted request surfaces as a timeout, never as a null result", async () => {
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch;

    await expect(
      metaApiRequest({
        service: "client",
        region: "london",
        path: "/slow",
        label: "XAUUSD H4",
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(MetaApiTimeoutError);
  });

  it("[UNIT] maps a non-2xx response to MetaApiHttpError with retry-after", async () => {
    globalThis.fetch = (async () =>
      jsonResponse("slow down", 429, { "retry-after": "12" })) as unknown as typeof fetch;

    const err = await metaApiRequest({
      service: "metastats",
      region: "london",

      path: "/x",
      label: "metrics",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiHttpError);
    expect((err as MetaApiHttpError).status).toBe(429);
    expect((err as MetaApiHttpError).retryAfterSeconds).toBe(12);
  });

  it("[UNIT] preserves both Retry-After encodings used by the provider", () => {
    const now = Date.parse("2026-08-24T00:00:00Z");
    expect(parseRetryAfterSeconds("12", now)).toBe(12);
    expect(parseRetryAfterSeconds("Mon, 24 Aug 2026 00:00:12 GMT", now)).toBe(12);
    expect(parseRetryAfterSeconds("not-a-date", now)).toBeNull();
  });

  it("[UNIT] treats 202 as an error only when the caller opts in", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ pending: true }, 202, { "retry-after": "30" })) as unknown as typeof fetch;

    await expect(
      metaApiRequest({
        service: "metastats",
        region: "london",
        path: "/x",
        label: "metrics",
        throwOn202: true,
      }),
    ).rejects.toBeInstanceOf(MetaApiHttpError);
    await expect(
      metaApiRequest({ service: "metastats", region: "london", path: "/x", label: "metrics" }),
    ).resolves.toEqual({ pending: true });
  });

  it("[UNIT] an empty body is null rather than a parse failure", async () => {
    globalThis.fetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    await expect(
      metaApiRequest({ service: "provisioning", path: "/x", label: "deploy" }),
    ).resolves.toBeNull();
  });

  it("[INVARIANT] a general read falls back to the provisioning token only after 403", async () => {
    process.env["METAAPI_TOKEN"] = "general-token";
    process.env["METAAPI_PROVISIONING_TOKEN"] = "provisioning-token";
    const seen: string[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const token = (init?.headers as Record<string, string>)["auth-token"]!;
      seen.push(token);
      return token === "general-token"
        ? jsonResponse({ error: "ForbiddenError" }, 403)
        : jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    await expect(
      metaApiRequest({ service: "client", region: "london", path: "/x", label: "read" }),
    ).resolves.toEqual({ ok: true });
    expect(seen).toEqual(["general-token", "provisioning-token"]);
  });

  it("[INVARIANT] provisioning prefers its token and can fall back to the general token", async () => {
    process.env["METAAPI_TOKEN"] = "general-token";
    process.env["METAAPI_PROVISIONING_TOKEN"] = "provisioning-token";
    const seen: string[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const token = (init?.headers as Record<string, string>)["auth-token"]!;
      seen.push(token);
      return token === "provisioning-token"
        ? jsonResponse({ error: "ForbiddenError" }, 403)
        : jsonResponse({ id: "account-id" });
    }) as unknown as typeof fetch;

    await expect(
      metaApiRequest({ service: "provisioning", path: "/x", label: "read account" }),
    ).resolves.toEqual({ id: "account-id" });
    expect(seen).toEqual(["provisioning-token", "general-token"]);
  });

  it("[INVARIANT] retries a transient 504 once for GET with the same token", async () => {
    process.env["METAAPI_PROVISIONING_TOKEN"] = "alternate-token";
    const seen: string[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>)["auth-token"]!);
      return seen.length === 1 ? jsonResponse("gateway timeout", 504) : jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    await expect(
      metaApiRequest({ service: "client", region: "london", path: "/x", label: "candles" }),
    ).resolves.toEqual({ ok: true });
    expect(seen).toEqual(["test-token", "test-token"]);
  });

  it("[INVARIANT] never retries or swaps tokens for a mutation after a 504", async () => {
    process.env["METAAPI_PROVISIONING_TOKEN"] = "alternate-token";
    const fetchMock = vi.fn(async () => jsonResponse("gateway timeout", 504));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      metaApiRequest({
        service: "provisioning",
        method: "POST",
        path: "/x",
        label: "deploy account",
      }),
    ).rejects.toMatchObject({ status: 504 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
