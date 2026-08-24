import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "../provision.server";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_TOKEN = process.env["METAAPI_TOKEN"];
const ORIGINAL_PROVISIONING = process.env["METAAPI_PROVISIONING_TOKEN"];

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
        magic: 0,
        reliability: "regular",
        manualTrades: true,
        metastatsApiEnabled: false,
        riskManagementApiEnabled: false,
        draft,
      },
      "txn-1",
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
  });

  it("[UNIT] returns the provider-reported state rather than assuming one", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "acc-2", state: "UNDEPLOYED" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const created = await createAccount(
      { name: "n", platform: "mt4", region: "london", magic: 0, draft: true },
      "txn-2",
    );
    expect(created).toEqual({ id: "acc-2", state: "UNDEPLOYED" });
  });
});
