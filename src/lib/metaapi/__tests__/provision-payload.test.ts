import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiHttpError } from "../errors";
import { canonicalTransactionId, createAccount } from "../provision.server";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_TOKEN = process.env["METAAPI_TOKEN"];
const ORIGINAL_PROVISIONING = process.env["METAAPI_PROVISIONING_TOKEN"];
const TXN_ONE = "1234567890abcdef1234567890abcdef";
const TXN_TWO = "abcdef1234567890abcdef1234567890";

describe("createAccount payload", () => {
  beforeEach(() => {
    process.env["METAAPI_TOKEN"] = "test-token";
    delete process.env["METAAPI_PROVISIONING_TOKEN"];
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
    if (ORIGINAL_TOKEN === undefined) delete process.env["METAAPI_TOKEN"];
    else process.env["METAAPI_TOKEN"] = ORIGINAL_TOKEN;
    if (ORIGINAL_PROVISIONING === undefined) delete process.env["METAAPI_PROVISIONING_TOKEN"];
    else process.env["METAAPI_PROVISIONING_TOKEN"] = ORIGINAL_PROVISIONING;
  });

  async function capture(draft: boolean): Promise<Record<string, unknown>> {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "acc-1", state: "DRAFT" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await createAccount(
      {
        name: "P-Trades Demo",
        platform: "mt5",
        server: "MetaQuotes-Demo",
        region: "london",
        magic: 771234,
        reliability: "regular",
        manualTrades: false,
        metastatsApiEnabled: false,
        riskManagementApiEnabled: false,
        draft,
      },
      TXN_ONE,
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  it("[INVARIANT] never sends `state` — the provider rejects it with a 400 ValidationError", async () => {
    expect(await capture(true)).not.toHaveProperty("state");
    expect(await capture(false)).not.toHaveProperty("state");
  });

  it("[INVARIANT] a draft carries no broker credentials, which is what makes it a draft", async () => {
    const body = await capture(true);
    expect(body).not.toHaveProperty("login");
    expect(body).not.toHaveProperty("password");
    expect(body["server"]).toBe("MetaQuotes-Demo");
    expect(body["type"]).toBe("cloud-g2");
    expect(body["manualTrades"]).toBe(false);
    expect(body["magic"]).toBe(771234);
  });

  it("[INVARIANT] refuses manual MetaApi trades with a non-zero magic before HTTP", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      createAccount(
        {
          name: "n",
          platform: "mt5",
          server: "MetaQuotes-Demo",
          region: "london",
          magic: 771234,
          manualTrades: true,
        },
        TXN_ONE,
      ),
    ).rejects.toThrow(/manual MetaApi trades require magic 0/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[UNIT] returns the provider-reported state rather than assuming one", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "acc-2", state: "UNDEPLOYED" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const created = await createAccount(
      { name: "n", platform: "mt4", region: "london", magic: 0, draft: true },
      TXN_TWO,
    );
    expect(created).toEqual({ id: "acc-2", state: "UNDEPLOYED" });
  });

  it("[INVARIANT] surfaces 202 as pending so callers can poll with the same transaction id", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "still processing" }), {
          status: 202,
          headers: { "retry-after": "30" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transactionId = "1234567890abcdef1234567890abcdef";
    const err = await createAccount(
      { name: "n", platform: "mt5", server: "MetaQuotes-Demo", region: "london", magic: 0 },
      transactionId,
    ).catch((value: unknown) => value);
    expect(err).toBeInstanceOf(MetaApiHttpError);
    expect(err).toMatchObject({ status: 202, retryAfterSeconds: 30 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["transaction-id"]).toBe(transactionId);
  });

  it("[INVARIANT] canonicalises a persisted UUID at the final HTTP boundary", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "acc-3", state: "DRAFT" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await createAccount(
      { name: "n", platform: "mt5", server: "MetaQuotes-Demo", region: "london", magic: 1 },
      "d149c96b-3f66-48e6-99a2-ef0943a12503",
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["transaction-id"]).toBe(
      "d149c96b3f6648e699a2ef0943a12503",
    );
  });

  it("[INVARIANT] refuses malformed ids before an HTTP request can leave P-Trades", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      createAccount(
        { name: "n", platform: "mt5", server: "MetaQuotes-Demo", region: "london", magic: 1 },
        "too-short",
      ),
    ).rejects.toThrow(/exactly 32 hexadecimal characters/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[UNIT] canonical transaction ids contain exactly 32 hexadecimal characters", () => {
    expect(canonicalTransactionId(" D149C96B-3F66-48E6-99A2-EF0943A12503 ")).toBe(
      "d149c96b3f6648e699a2ef0943a12503",
    );
  });

  it("[INVARIANT] attests the local invariant if MetaApi still rejects the header", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 5566,
            error: "ValidationError",
            message: "Transaction-id header must be 32 characters long",
          }),
          { status: 400 },
        ),
    ) as unknown as typeof fetch;

    await expect(
      createAccount(
        { name: "n", platform: "mt5", server: "MetaQuotes-Demo", region: "london", magic: 1 },
        TXN_ONE,
      ),
    ).rejects.toThrow(/locally validated a 32-character transaction-id/i);
  });
});
