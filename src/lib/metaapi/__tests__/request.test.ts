import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiHttpError, MetaApiNotConfiguredError, MetaApiTimeoutError } from "../errors";
import { metaApiRequest } from "../request.server";

const ORIGINAL_FETCH = globalThis.fetch;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

describe("metaApiRequest", () => {
  beforeEach(() => {
    process.env["METAAPI_TOKEN"] = "test-token";
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

  it("[UNIT] treats 202 as an error only when the caller opts in", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ pending: true }, 202, { "retry-after": "30" })) as unknown as typeof fetch;

    await expect(
      metaApiRequest({ service: "metastats", region: "london", path: "/x", label: "metrics", throwOn202: true }),
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

});
