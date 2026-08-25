/**
 * Coverage and identity invariants.
 *
 * The property under test throughout: incomplete provider data can never become
 * healthy coverage, and healthy coverage can never be produced by a failed fetch.
 */
import { describe, expect, it } from "vitest";

import { computeCoverage, coverageClears, mergeProviderCoverage, worstCoverage } from "../coverage";
import {
  currenciesOfInstrument,
  eventChecksum,
  instrumentsForEvent,
  requiredCoverageFor,
} from "../identity";
import { redactText, redactUrl, safeNote } from "../redact";
import { batchStatusIsHealthy, type NormalizedEvent, type ProviderBatchStatus } from "../types";

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    providerEventKey: "fred:release:10:2026-09-10",
    canonicalEventId: "usd:us-cpi:2026-09-10",
    family: "inflation",
    countries: ["US"],
    currencies: ["USD"],
    importance: "high",
    scheduledAt: null,
    scheduledDate: "2026-09-10",
    timestampPrecision: "date_only",
    status: "scheduled",
    actual: null,
    forecast: null,
    previous: null,
    units: null,
    providerUpdatedAt: null,
    fieldProvenance: {},
    diagnostics: {},
    ...overrides,
  };
}

describe("news coverage", () => {
  it("[INVARIANT] a failed fetch never yields healthy coverage", () => {
    const failures: ProviderBatchStatus[] = [
      "partial",
      "throttled",
      "outage",
      "authorization_error",
      "invalid_response",
      "stale",
    ];
    for (const status of failures) {
      const snapshots = computeCoverage({
        provider: "fred",
        batchStatus: status,
        requestedScopes: [{ currency: "USD", family: "inflation" }],
        unsupported: [],
        events: [],
      });
      expect(batchStatusIsHealthy(status)).toBe(false);
      expect(snapshots[0]!.state).not.toBe("healthy");
      expect(coverageClears(snapshots[0]!.state)).toBe(false);
    }
  });

  it("[INVARIANT] a date-only schedule downgrades coverage to timestamp_incomplete", () => {
    const snapshots = computeCoverage({
      provider: "fred",
      batchStatus: "ok",
      requestedScopes: [{ currency: "USD", family: "inflation" }],
      unsupported: [],
      events: [event()],
    });
    expect(snapshots[0]!.state).toBe("timestamp_incomplete");
    expect(coverageClears("timestamp_incomplete")).toBe(false);
  });

  it("[UNIT] exact timestamps with a healthy batch are healthy coverage", () => {
    const snapshots = computeCoverage({
      provider: "test",
      batchStatus: "ok",
      requestedScopes: [{ currency: "USD", family: "inflation" }],
      unsupported: [],
      events: [event({ timestampPrecision: "exact", scheduledAt: "2026-09-10T12:30:00Z" })],
    });
    expect(snapshots[0]!.state).toBe("healthy");
    expect(snapshots[0]!.exactTimestampCount).toBe(1);
  });

  it("[UNIT] an empty window is healthy only when the provider answered completely", () => {
    const ok = computeCoverage({
      provider: "fred",
      batchStatus: "empty",
      requestedScopes: [{ currency: "USD", family: "employment" }],
      unsupported: [],
      events: [],
    });
    expect(ok[0]!.state).toBe("healthy");

    const throttled = computeCoverage({
      provider: "fred",
      batchStatus: "throttled",
      requestedScopes: [{ currency: "USD", family: "employment" }],
      unsupported: [],
      events: [],
    });
    expect(throttled[0]!.state).toBe("provider_error");
  });

  it("[UNIT] a declared unsupported scope is reported as unsupported, not as empty", () => {
    const snapshots = computeCoverage({
      provider: "fred",
      batchStatus: "ok",
      requestedScopes: [
        { currency: "GBP", family: "inflation" },
        { currency: "USD", family: "inflation" },
      ],
      unsupported: [{ currency: "GBP", note: "US only" }],
      events: [event({ timestampPrecision: "exact", scheduledAt: "2026-09-10T12:30:00Z" })],
    });
    const gbp = snapshots.find((s) => s.currency === "GBP")!;
    expect(gbp.state).toBe("unsupported");
    expect(snapshots.find((s) => s.currency === "USD")!.state).toBe("healthy");
  });

  it("[INVARIANT] worstCoverage never reports better than its worst input", () => {
    expect(worstCoverage(["healthy", "unsupported", "healthy"])).toBe("unsupported");
    expect(worstCoverage(["healthy", "timestamp_incomplete"])).toBe("timestamp_incomplete");
    expect(worstCoverage([])).toBe("unproven");
  });

  it("[UNIT] merging providers keeps the most complete state per scope", () => {
    const merged = mergeProviderCoverage([
      {
        provider: "a",
        currency: "USD",
        family: "energy_inventory",
        state: "unsupported",
        eventCount: 0,
        exactTimestampCount: 0,
        dateOnlyCount: 0,
        lastEventAt: null,
        note: "",
      },
      {
        provider: "b",
        currency: "USD",
        family: "energy_inventory",
        state: "timestamp_incomplete",
        eventCount: 2,
        exactTimestampCount: 0,
        dateOnlyCount: 2,
        lastEventAt: null,
        note: "",
      },
    ]);
    expect(merged.get("USD|energy_inventory")).toBe("timestamp_incomplete");
  });
});

describe("news identity", () => {
  it("[UNIT] a metal or index does not claim its base is a currency", () => {
    expect(currenciesOfInstrument("XAUUSD")).toEqual(["USD"]);
    expect(currenciesOfInstrument("NAS100")).toEqual(["USD"]);
    expect(currenciesOfInstrument("GBPUSD").sort()).toEqual(["GBP", "USD"]);
  });

  it("[UNIT] energy events map to energy instruments only", () => {
    const affected = instrumentsForEvent({ family: "energy_inventory", currencies: ["USD"] });
    expect(affected).toContain("USOIL");
    expect(affected).toContain("UKOIL");
    expect(affected).not.toContain("EURUSD");
  });

  it("[UNIT] a USD inflation event reaches every USD-exposed FX pair and metal", () => {
    const affected = instrumentsForEvent({ family: "inflation", currencies: ["USD"] });
    expect(affected).toContain("EURUSD");
    expect(affected).toContain("XAUUSD");
    expect(affected).not.toContain("GBPAUD");
  });

  it("[INVARIANT] the checksum ignores nothing that policy depends on", () => {
    const base = event({ timestampPrecision: "exact", scheduledAt: "2026-09-10T12:30:00Z" });
    expect(eventChecksum(base)).toBe(eventChecksum({ ...base }));
    expect(eventChecksum({ ...base, scheduledAt: "2026-09-10T13:30:00Z" })).not.toBe(
      eventChecksum(base),
    );
    expect(eventChecksum({ ...base, importance: "low" })).not.toBe(eventChecksum(base));
    expect(eventChecksum({ ...base, actual: 1 })).not.toBe(eventChecksum(base));
  });

  it("[UNIT] required coverage is derived per instrument, not shared", () => {
    expect(requiredCoverageFor("USOIL").families).toContain("energy_inventory");
    expect(requiredCoverageFor("EURUSD").families).not.toContain("energy_inventory");
  });
});

describe("news redaction", () => {
  it("[INVARIANT] a credential in a query string never survives redaction", () => {
    const url = "https://api.stlouisfed.org/fred/releases?api_key=abcdef1234567890&file_type=json";
    expect(redactUrl(url)).not.toContain("abcdef1234567890");
    expect(redactText(`fetch failed for ${url}`)).not.toContain("abcdef1234567890");
    expect(safeNote(new Error(`bad key abcdef1234567890`), ["abcdef1234567890"])).not.toContain(
      "abcdef1234567890",
    );
  });

  it("[UNIT] notes are bounded in length", () => {
    expect(safeNote("x".repeat(1000))!.length).toBeLessThanOrEqual(301);
  });
});
