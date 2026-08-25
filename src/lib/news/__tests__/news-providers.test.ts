/**
 * Adapter contract tests.
 *
 * Every failure mode is exercised through an injected fetch, so the suite proves
 * the adapters classify provider failures rather than proving the provider is up.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEiaProvider, classifyEiaDataset, EIA_UNSUPPORTED } from "../providers/eia.server";
import { createFredProvider, FRED_RELEASES, FRED_UNSUPPORTED } from "../providers/fred.server";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("FRED adapter", () => {
  it("[UNIT] a missing credential is an authorization_error, not an empty calendar", async () => {
    const batch = await createFredProvider("").fetchEvents({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(batch.status).toBe("authorization_error");
    expect(batch.events).toEqual([]);
  });

  it("[INVARIANT] every emitted event is date_only precision with no invented instant", async () => {
    mockFetch(200, {
      release_dates: [
        { release_id: 10, date: "2026-09-10" },
        { release_id: 50, date: "2026-09-04" },
      ],
    });
    const batch = await createFredProvider("k".repeat(32)).fetchEvents({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(batch.status).toBe("ok");
    expect(batch.events).toHaveLength(2);
    for (const event of batch.events) {
      expect(event.timestampPrecision).toBe("date_only");
      expect(event.scheduledAt).toBeNull();
      expect(event.actual).toBeNull();
      expect(event.currencies).toEqual(["USD"]);
    }
  });

  it("[UNIT] releases outside the allow-list are dropped rather than guessed into a family", async () => {
    mockFetch(200, { release_dates: [{ release_id: 999999, date: "2026-09-10" }] });
    const batch = await createFredProvider("k".repeat(32)).fetchEvents({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(batch.status).toBe("empty");
    expect(batch.events).toEqual([]);
  });

  it("[UNIT] provider failures are classified distinctly", async () => {
    const key = "k".repeat(32);
    mockFetch(429, {});
    expect((await createFredProvider(key).fetchEvents({ from: "a", to: "b" })).status).toBe(
      "throttled",
    );
    mockFetch(403, { error_message: "bad key" });
    expect((await createFredProvider(key).fetchEvents({ from: "a", to: "b" })).status).toBe(
      "authorization_error",
    );
    mockFetch(503, {});
    expect((await createFredProvider(key).fetchEvents({ from: "a", to: "b" })).status).toBe(
      "outage",
    );
    mockFetch(200, { unexpected: true });
    expect((await createFredProvider(key).fetchEvents({ from: "a", to: "b" })).status).toBe(
      "invalid_response",
    );
  });

  it("[INVARIANT] FRED declares every non-USD currency and every non-macro family unsupported", () => {
    for (const currency of ["EUR", "GBP", "JPY", "AUD", "CAD", "CHF"]) {
      expect(FRED_UNSUPPORTED.some((s) => s.currency === currency)).toBe(true);
    }
    expect(FRED_UNSUPPORTED.some((s) => s.family === "energy_inventory")).toBe(true);
    expect(FRED_UNSUPPORTED.some((s) => s.family === "opec_supply")).toBe(true);
  });

  it("[UNIT] release ids in the allow-list are unique", () => {
    const ids = FRED_RELEASES.map((r) => r.releaseId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("EIA adapter", () => {
  it("[UNIT] an invalid credential is reported as authorization_error", async () => {
    mockFetch(403, { error: { code: "API_KEY_INVALID", message: "invalid" } });
    const batch = await createEiaProvider("short-key").fetchEvents({
      from: "2026-08-01",
      to: "2026-09-10",
    });
    expect(batch.status).toBe("authorization_error");
    expect(batch.errorClass).toBe("rejected_credential");
  });

  it("[UNIT] weekly stock rows are ingested as published values with date_only precision", async () => {
    mockFetch(200, {
      response: {
        data: [{ period: "2026-09-04", series: "WCESTUS1", value: 421000, units: "MBBL" }],
      },
    });
    const batch = await createEiaProvider("k".repeat(40)).fetchEvents({
      from: "2026-08-01",
      to: "2026-09-10",
    });
    expect(batch.status).toBe("ok");
    expect(batch.events[0]!.status).toBe("published");
    expect(batch.events[0]!.actual).toBe(421000);
    expect(batch.events[0]!.timestampPrecision).toBe("date_only");
    expect(batch.events[0]!.family).toBe("energy_inventory");
  });

  it("[INVARIANT] EIA never emits a forward-scheduled event, because no schedule endpoint exists", async () => {
    mockFetch(200, {
      response: { data: [{ period: "2026-09-04", series: "WCESTUS1", value: 1, units: "MBBL" }] },
    });
    const batch = await createEiaProvider("k".repeat(40)).fetchEvents({
      from: "2026-08-01",
      to: "2026-09-10",
    });
    for (const event of batch.events) expect(event.scheduledAt).toBeNull();
  });

  it("[INVARIANT] OPEC supply is declared unsupported rather than silently uncovered", () => {
    expect(EIA_UNSUPPORTED.some((s) => s.family === "opec_supply")).toBe(true);
  });

  it("[UNIT] monthly datasets are classified as context, not as tradable events", () => {
    expect(classifyEiaDataset("/petroleum/move/impcus/data/?frequency=monthly")).toBe(
      "context_monthly",
    );
    expect(classifyEiaDataset("/petroleum/stoc/wstk/data/?frequency=weekly")).toBe(
      "tradable_weekly",
    );
  });
});
