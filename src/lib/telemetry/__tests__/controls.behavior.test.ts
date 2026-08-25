import { describe, expect, it } from "vitest";

import { readTelemetryControls } from "../controls.server";
import { MAX_INSTRUMENTS_PER_RUN, MAX_REQUESTS_PER_RUN } from "../sampler";

type Row = Record<string, unknown> | null;

function fakeDb(row: Row, error: { message: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error }),
        }),
      }),
    }),
  } as never;
}

const ENABLED = {
  sampler_enabled: true,
  aggregation_enabled: true,
  retention_enabled: true,
  capacity_enabled: true,
  readiness_enabled: true,
  sampler_symbols: ["XAUUSD", "GBPAUD", "EURUSD"],
  max_instruments_per_run: 3,
  max_requests_per_run: 6,
  daily_request_budget: 288,
  note: null,
  updated_at: "2026-08-26T00:00:00.000Z",
};

describe("telemetry controls", () => {
  it("[UNIT] reads the live switches and symbol scope", async () => {
    const controls = await readTelemetryControls(fakeDb(ENABLED));
    expect(controls.degraded).toBe(false);
    expect(controls.samplerEnabled).toBe(true);
    expect(controls.samplerSymbols).toEqual(["XAUUSD", "GBPAUD", "EURUSD"]);
  });

  it("[INVARIANT] an unreadable control row disables every capability", async () => {
    for (const db of [fakeDb(null), fakeDb(ENABLED, { message: "boom" })]) {
      const controls = await readTelemetryControls(db);
      expect(controls.degraded).toBe(true);
      expect(controls.samplerEnabled).toBe(false);
      expect(controls.aggregationEnabled).toBe(false);
      expect(controls.retentionEnabled).toBe(false);
      expect(controls.capacityEnabled).toBe(false);
      expect(controls.readinessEnabled).toBe(false);
      expect(controls.maxRequestsPerRun).toBe(0);
    }
  });

  it("[INVARIANT] stored settings can lower the provider ceilings but never raise them", async () => {
    const inflated = await readTelemetryControls(
      fakeDb({ ...ENABLED, max_instruments_per_run: 99, max_requests_per_run: 500 }),
    );
    expect(inflated.maxInstrumentsPerRun).toBe(MAX_INSTRUMENTS_PER_RUN);
    expect(inflated.maxRequestsPerRun).toBe(MAX_REQUESTS_PER_RUN);

    const lowered = await readTelemetryControls(
      fakeDb({ ...ENABLED, max_instruments_per_run: 1, max_requests_per_run: 1 }),
    );
    expect(lowered.maxInstrumentsPerRun).toBe(1);
    expect(lowered.maxRequestsPerRun).toBe(1);
  });
});
