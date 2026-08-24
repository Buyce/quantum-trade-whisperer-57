import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adoptConnection,
  assertNotBenchmarkAccount,
  newAccountOrderTag,
  newProvisionTransactionId,
  startConnection,
} from "../provision.server";

const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;

const fakeAdmin = vi.hoisted(() => {
  const state = {
    existing: [] as { id: string; disconnected_at: string | null }[],
    existingError: null as { message: string } | null,
    insertError: null as { message: string } | null,
    inserted: null as Record<string, unknown> | null,
    fromCalls: 0,
  };

  const db = {
    from() {
      state.fromCalls += 1;
      let operation: "read" | "insert" = "read";
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        is() {
          return chain;
        },
        limit() {
          return Promise.resolve({ data: state.existing, error: state.existingError });
        },
        insert(row: Record<string, unknown>) {
          operation = "insert";
          state.inserted = row;
          return chain;
        },
        single() {
          return Promise.resolve(
            operation === "insert"
              ? {
                  data: state.insertError ? null : { id: "local-account-1" },
                  error: state.insertError,
                }
              : { data: null, error: { message: "stop reconciliation in unit fake" } },
          );
        },
        maybeSingle() {
          return Promise.resolve({
            data: null,
            error: { message: "stop reconciliation in unit fake" },
          });
        },
      };
      return chain;
    },
  };

  return { state, db };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin.db }));

function tokenWith(accessRules: unknown): string {
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS512" })}.${b64({ accessRules })}.signature`;
}

afterEach(() => {
  process.env = { ...savedEnv };
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});

describe("provider transaction ids", () => {
  it("[INVARIANT] generates exactly 32 hexadecimal characters", () => {
    expect(newProvisionTransactionId()).toMatch(/^[0-9a-f]{32}$/);
  });
});

beforeEach(() => {
  fakeAdmin.state.existing = [];
  fakeAdmin.state.existingError = null;
  fakeAdmin.state.insertError = null;
  fakeAdmin.state.inserted = null;
  fakeAdmin.state.fromCalls = 0;
  process.env["METAAPI_TOKEN"] = "opaque-test-token";
  delete process.env["METAAPI_PROVISIONING_TOKEN"];
  delete process.env["PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID"];
});

describe("broker provisioning guards", () => {
  it("[INVARIANT] generates positive integer order tags accepted by the database boundary", () => {
    for (let i = 0; i < 100; i += 1) {
      const tag = newAccountOrderTag();
      expect(Number.isInteger(tag)).toBe(true);
      expect(tag).toBeGreaterThanOrEqual(1_000_000);
      expect(tag).toBeLessThan(2_000_000_000);
    }
  });

  it("[INVARIANT] protects the benchmark id even when other benchmark settings are invalid", () => {
    process.env["PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID"] = "F6A72106-7709-4835-8022-75CAD470A505";
    delete process.env["PTRADES_BENCHMARK_METAAPI_REGION"];
    process.env["PTRADES_BENCHMARK_MAGIC"] = "invalid";

    expect(() => assertNotBenchmarkAccount("f6a72106-7709-4835-8022-75cad470a505")).toThrow(
      /reserved by P-Trades/i,
    );
    expect(() => assertNotBenchmarkAccount("e3e72106-7709-4835-8022-75cad470a999")).not.toThrow();
  });

  it("[INVARIANT] refuses adoption of the benchmark before reading the database or provider", async () => {
    const benchmarkId = "f6a72106-7709-4835-8022-75cad470a505";
    process.env["PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID"] = benchmarkId;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      adoptConnection({
        userId: "076b4419-2e83-4180-a5aa-a8b270c429a9",
        label: "Benchmark",
        metaapiAccountId: benchmarkId,
        intent: "demo",
      }),
    ).rejects.toThrow(/reserved by P-Trades/i);
    expect(fakeAdmin.state.fromCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[INVARIANT] refuses an account already linked to another connection", async () => {
    fakeAdmin.state.existing = [{ id: "existing", disconnected_at: null }];
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      adoptConnection({
        userId: "076b4419-2e83-4180-a5aa-a8b270c429a9",
        label: "Existing",
        metaapiAccountId: "e3e72106-7709-4835-8022-75cad470a999",
        intent: "demo",
      }),
    ).rejects.toThrow(/already linked/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[INVARIANT] translates the database quota refusal without linking the account", async () => {
    fakeAdmin.state.insertError = { message: "account_quota_exceeded" };
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          _id: "e3e72106-7709-4835-8022-75cad470a999",
          platform: "mt5",
          server: "MetaQuotes-Demo",
          region: "london",
          login: 123456,
          state: "DEPLOYED",
          connectionStatus: "CONNECTED",
        }),
        { status: 200 },
      )) as typeof fetch;

    await expect(
      adoptConnection({
        userId: "076b4419-2e83-4180-a5aa-a8b270c429a9",
        label: "Quota account",
        metaapiAccountId: "e3e72106-7709-4835-8022-75cad470a999",
        intent: "demo",
      }),
    ).rejects.toThrow(/reached your limit/i);
  });

  it("[UNIT] links provider-derived facts into Observe and assigns an evidence tag", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          _id: "e3e72106-7709-4835-8022-75cad470a999",
          platform: "mt5",
          server: "MetaQuotes-Demo",
          region: "london",
          login: 123456,
          state: "DEPLOYED",
          connectionStatus: "CONNECTED",
        }),
        { status: 200 },
      )) as typeof fetch;

    await expect(
      adoptConnection({
        userId: "076b4419-2e83-4180-a5aa-a8b270c429a9",
        label: "Linked demo",
        metaapiAccountId: "e3e72106-7709-4835-8022-75cad470a999",
        intent: "demo",
      }),
    ).resolves.toEqual({ accountId: "local-account-1" });

    expect(fakeAdmin.state.inserted).toMatchObject({
      platform: "mt5",
      broker_server: "MetaQuotes-Demo",
      region: "london",
      phase: "awaiting_credentials",
      mode: "observe",
    });
    expect(fakeAdmin.state.inserted?.["magic"]).toEqual(expect.any(Number));
  });

  it("[INVARIANT] rejects a known account-scoped token before a local quota row is opened", async () => {
    delete process.env["METAAPI_PROVISIONING_TOKEN"];
    process.env["METAAPI_TOKEN"] = tokenWith([
      {
        id: "trading-account-management-api",
        methods: [],
        roles: ["reader", "writer"],
        resources: ["*:$USER_ID$:f6a72106-7709-4835-8022-75cad470a505"],
      },
    ]);

    await expect(
      startConnection({
        userId: "076b4419-2e83-4180-a5aa-a8b270c429a9",
        label: "Demo account",
        platform: "mt5",
        brokerServer: "MetaQuotes-Demo",
        region: "london",
        intent: "demo",
      }),
    ).rejects.toThrow(/restricted to specific trading accounts/i);
  });
});
