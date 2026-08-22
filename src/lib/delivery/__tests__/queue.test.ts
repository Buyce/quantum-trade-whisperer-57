/**
 * Focused queue / idempotency / revalidation-boundary tests for the execution
 * delivery worker. These assert the financial safety properties of the state
 * machine rather than the happy path: at most ONE automatic outbound POST per
 * delivery identity, `sent` never meaning "broker accepted", and ambiguous
 * post-send state degrading to `unknown` instead of being retried.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostAllowedForLive, isClaimable, isTerminal, type DeliveryState } from "../execution";

const revalidate = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../revalidate.server", () => ({
  revalidateDelivery: (...args: unknown[]) => revalidate.fn(...args),
}));

const { processNextDelivery } = await import("../dispatch.server");

interface FakeDb {
  rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: null }>;
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, value: unknown) => Promise<{ error: null }>;
    };
  };
  patches: Record<string, unknown>[];
  claims: number;
}

function fakeDb(rows: Record<string, unknown>[]): FakeDb {
  const patches: Record<string, unknown>[] = [];
  const db: FakeDb = {
    patches,
    claims: 0,
    rpc: async () => {
      db.claims += 1;
      const next = rows.shift();
      return { data: next ? [next] : [], error: null };
    },
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          patches.push(patch);
          return { error: null };
        },
      }),
    }),
  };
  return db;
}

const delivery = {
  id: 7,
  user_id: "u1",
  signal_id: "sig-1",
  bridge_profile: "primary",
  dry_run: false,
  execution_config_version: 4,
};

const approved = {
  ok: true as const,
  policy: "single_exit_first_target" as const,
  order: {
    signalId: "sig-1",
    instrument: "EURUSD",
    action: "buy_limit" as const,
    entry: 1.156,
    maxAcceptableEntry: 1.15615,
    stopLoss: 1.155,
    takeProfit: 1.157,
    expiresInMinutes: 30,
    policy: "single_exit_first_target" as const,
    grade: "A",
    rr: 3,
    confidence: 82,
    quantity: {
      lots: 0.24,
      sizingModel: 1 as const,
      specSource: "static_v1" as const,
      specAsOf: null,
    },
  },
  endpoint: {
    url: "https://bridge.example.com/hook",
    host: "bridge.example.com",
    secret: "sek",
    format: "json" as const,
  },
  dryRun: false,
  dryRunReason: null,
  exposure: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  revalidate.fn.mockReset();
});

describe("claim discipline", () => {
  it("[INVARIANT] only pending is claimable; sent and unknown are terminal", () => {
    expect(isClaimable("pending")).toBe(true);
    for (const state of ["claimed", "sent", "acknowledged", "rejected", "unknown", "failed"]) {
      expect(isClaimable(state as DeliveryState)).toBe(false);
    }
    expect(isTerminal("sent")).toBe(true);
    expect(isTerminal("unknown")).toBe(true);
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("claimed")).toBe(false);
  });

  it("[INVARIANT] an empty queue is a no-op and sends nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const db = fakeDb([]);
    expect(await processNextDelivery(db as never)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.patches).toHaveLength(0);
  });
});

describe("revalidation boundary", () => {
  it("[INVARIANT] a refused revalidation never performs a POST", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    revalidate.fn.mockResolvedValue({
      ok: false,
      reason: "tif_expired",
      detail: "41 minutes old",
    });
    const db = fakeDb([{ ...delivery }]);
    const result = await processNextDelivery(db as never);
    expect(result?.state).toBe("rejected");
    expect(result?.reason).toContain("tif_expired");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("[INVARIANT] a thrown revalidation fails closed without sending", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    revalidate.fn.mockRejectedValue(new Error("quotes down"));
    const db = fakeDb([{ ...delivery }]);
    const result = await processNextDelivery(db as never);
    expect(result?.state).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("dry-run first", () => {
  it("[INVARIANT] dry-run validates and signs but issues no outbound request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    revalidate.fn.mockResolvedValue({ ...approved, dryRun: true });
    const db = fakeDb([{ ...delivery, dry_run: true }]);
    const result = await processNextDelivery(db as never);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: "acknowledged", dryRun: true });
    const settled = db.patches.at(-1)!;
    expect(settled['sent_at']).toBeNull();
    expect(settled['request_fingerprint']).toEqual(expect.any(String));
    expect(settled['payload_version']).toBe(2);
  });
});

describe("single attempt per delivery identity", () => {
  it("[INVARIANT] marks sent before the POST and carries a stable idempotency key", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init: RequestInit) => new Response('{"order_id":"55"}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    revalidate.fn.mockResolvedValue(approved);
    const db = fakeDb([{ ...delivery }]);
    const result = await processNextDelivery(db as never);

    const sentPatch = db.patches.find((p) => p['state'] === "sent");
    expect(sentPatch).toBeDefined();
    expect(db.patches.indexOf(sentPatch!)).toBeLessThan(db.patches.length - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const init = fetchSpy.mock.calls[0]![1];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-ptrades-idempotency-key']).toBe("sig-1-u1-primary");
    expect(headers['X-PTrades-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(init.redirect).toBe("manual");
    expect(result).toMatchObject({ state: "acknowledged" });
  });

  it("[INVARIANT] an unacknowledged 200 becomes unknown, not a retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"status":"ok"}', { status: 200 })));
    revalidate.fn.mockResolvedValue(approved);
    const db = fakeDb([{ ...delivery }]);
    const result = await processNextDelivery(db as never);
    expect(result?.state).toBe("unknown");
    // Nothing re-enqueues: no patch ever returns the row to `pending`.
    expect(db.patches.some((p) => p['state'] === "pending")).toBe(false);
  });

  it("[INVARIANT] a transport error after send is ambiguous, so it becomes unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    revalidate.fn.mockResolvedValue(approved);
    const db = fakeDb([{ ...delivery }]);
    const result = await processNextDelivery(db as never);
    expect(result?.state).toBe("unknown");
    expect(db.patches.some((p) => p['state'] === "pending")).toBe(false);
  });

  it("[INVARIANT] an explicit bridge error is a rejection, and still only one POST", async () => {
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 403 }));
    vi.stubGlobal("fetch", fetchSpy);
    revalidate.fn.mockResolvedValue(approved);
    const db = fakeDb([{ ...delivery }]);
    const result = await processNextDelivery(db as never);
    expect(result?.state).toBe("rejected");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("live destination allowlist", () => {
  it("[INVARIANT] an empty allowlist trusts no live destination", () => {
    expect(hostAllowedForLive("bridge.example.com", [])).toBe(false);
  });

  it("[INVARIANT] exact hosts and dot-suffixes match, lookalikes do not", () => {
    const list = ["bridge.example.com", ".pineconnector.net"];
    expect(hostAllowedForLive("bridge.example.com", list)).toBe(true);
    expect(hostAllowedForLive("BRIDGE.EXAMPLE.COM.", list)).toBe(true);
    expect(hostAllowedForLive("eu.pineconnector.net", list)).toBe(true);
    expect(hostAllowedForLive("evil-pineconnector.net", list)).toBe(false);
    expect(hostAllowedForLive("bridge.example.com.attacker.io", list)).toBe(false);
    expect(hostAllowedForLive("", list)).toBe(false);
  });
});
