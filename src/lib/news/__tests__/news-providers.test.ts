/**
 * Adapter contract tests.
 *
 * Every failure mode is exercised through an injected fetch, so the suite proves
 * the adapters classify provider failures rather than proving the provider is up.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

