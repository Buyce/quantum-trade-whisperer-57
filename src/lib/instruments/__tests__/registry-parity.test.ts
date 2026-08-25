/**
 * Phase A safety net.
 *
 * The registry's whole purpose is to be a REFACTOR, not a behaviour change: every
 * Wave 0 number must survive it byte-for-byte, and no Wave 1 pair may leak into a
 * production surface just because it now has a definition.
 */
import { describe, expect, it } from "vitest";
import {
  INSTRUMENT_DEFINITIONS,
  REGISTRY_SYMBOLS,
  WAVE0_SYMBOLS,
  WAVE1_SYMBOLS,
  contractSpecs,
  instrumentLabels,
  spreadFloors,
} from "../registry";
import {
  describeStage,
  fallbackStage,
  mayExecute,
  mayPublish,
  mayScan,
  stageOf,
  type InstrumentStage,
} from "../lifecycle";
import { ALL_INSTRUMENTS, INSTRUMENT_LABELS } from "@/lib/db-types";
import { CONTRACT_SPECS } from "@/lib/risk";
import { INSTRUMENTS, SPREAD_FLOOR, hasValidatedSpreadFloor } from "@/lib/scanner/types";
import { baseEligibility, type EligibilitySettings } from "@/lib/delivery/eligibility";

/** The literals that existed before the registry, copied from git HEAD~. */
const FROZEN_WAVE0 = ["XAUUSD", "GBPAUD", "EURUSD"];
const FROZEN_SPECS = {
  XAUUSD: { contractSize: 100, base: "XAU", quote: "USD", lotStep: 0.01, minLot: 0.01 },
  EURUSD: { contractSize: 100_000, base: "EUR", quote: "USD", lotStep: 0.01, minLot: 0.01 },
  GBPAUD: { contractSize: 100_000, base: "GBP", quote: "AUD", lotStep: 0.01, minLot: 0.01 },
};
const FROZEN_FLOORS = { EURUSD: 0.00015, GBPAUD: 0.0003, XAUUSD: 0.3 };
const FROZEN_LABELS = { XAUUSD: "Gold", GBPAUD: "GBP/AUD", EURUSD: "EUR/USD" };

describe("instrument registry parity", () => {
  it("[INVARIANT] the scan universe is still exactly Wave 0", () => {
    expect([...INSTRUMENTS]).toEqual(FROZEN_WAVE0);
    expect([...WAVE0_SYMBOLS]).toEqual(FROZEN_WAVE0);
  });

  it("[INVARIANT] the settings UI still offers exactly Wave 0", () => {
    expect(ALL_INSTRUMENTS).toEqual(FROZEN_WAVE0);
  });

  it("[INVARIANT] Wave 0 contract specifications are unchanged", () => {
    for (const [symbol, frozen] of Object.entries(FROZEN_SPECS)) {
      expect(CONTRACT_SPECS[symbol]).toEqual(frozen);
      expect(contractSpecs()[symbol]).toEqual(frozen);
    }
  });

  it("[INVARIANT] Wave 0 stop floors are unchanged and Wave 1 has none", () => {
    expect(SPREAD_FLOOR).toEqual(FROZEN_FLOORS);
    expect(spreadFloors()).toEqual(FROZEN_FLOORS);
    for (const symbol of WAVE1_SYMBOLS) {
      expect(hasValidatedSpreadFloor(symbol)).toBe(false);
    }
    for (const symbol of WAVE0_SYMBOLS) {
      expect(hasValidatedSpreadFloor(symbol)).toBe(true);
    }
  });

  it("[UNIT] labels every registry symbol, keeping the Wave 0 wording", () => {
    for (const [symbol, label] of Object.entries(FROZEN_LABELS)) {
      expect(INSTRUMENT_LABELS[symbol]).toBe(label);
    }
    for (const symbol of REGISTRY_SYMBOLS) {
      expect(instrumentLabels()[symbol]).toBeTruthy();
    }
  });

  it("[INVARIANT] JPY pairs do not inherit the 5-digit default", () => {
    const jpy = INSTRUMENT_DEFINITIONS.find((d) => d.symbol === "USDJPY")!;
    expect(jpy.fallbackDigits).toBe(3);
  });

  it("[INVARIANT] keeps every definition internally consistent", () => {
    for (const d of INSTRUMENT_DEFINITIONS) {
      expect(d.symbol).toBe(`${d.base}${d.quote}`.replace("XAUUSD", "XAUUSD"));
      expect(d.contractSize).toBeGreaterThan(0);
      expect(d.minLot).toBeGreaterThan(0);
      expect(d.lotStep).toBeGreaterThan(0);
      if (d.wave === 1) expect(d.spreadFloor).toBeNull();
    }
  });
});

describe("lifecycle stage semantics", () => {
  const stages: InstrumentStage[] = [
    "disabled",
    "data_validation",
    "shadow",
    "signals_only",
    "execution_approved",
    "suspended",
  ];

  it("[INVARIANT] only execution_approved may execute", () => {
    for (const stage of stages) {
      expect(mayExecute(stage)).toBe(stage === "execution_approved");
    }
  });

  it("[INVARIANT] research stages are measured but never published", () => {
    for (const stage of ["data_validation", "shadow"] as InstrumentStage[]) {
      expect(mayScan(stage)).toBe(true);
      expect(mayPublish(stage)).toBe(false);
      expect(mayExecute(stage)).toBe(false);
    }
  });

  it("[INVARIANT] suspended revokes everything, however far the pair had progressed", () => {
    expect(mayScan("suspended")).toBe(false);
    expect(mayPublish("suspended")).toBe(false);
    expect(mayExecute("suspended")).toBe(false);
  });

  it("[INVARIANT] signals_only publishes without executing", () => {
    expect(mayPublish("signals_only")).toBe(true);
    expect(mayExecute("signals_only")).toBe(false);
  });

  it("[INVARIANT] an unreadable stage keeps Wave 0 live and Wave 1 dark", () => {
    for (const symbol of WAVE0_SYMBOLS) {
      expect(fallbackStage(symbol)).toBe("execution_approved");
      expect(stageOf(symbol, null)).toBe("execution_approved");
      expect(stageOf(symbol, { [symbol]: "nonsense" } as never)).toBe("execution_approved");
    }
    for (const symbol of WAVE1_SYMBOLS) {
      expect(fallbackStage(symbol)).toBe("disabled");
      expect(stageOf(symbol, {})).toBe("disabled");
    }
  });

  it("[UNIT] describes every stage in plain language", () => {
    for (const stage of stages) expect(describeStage(stage).length).toBeGreaterThan(3);
  });
});

describe("empty instrument preference means Wave 0, not everything", () => {
  const settings: EligibilitySettings = {
    instruments: [],
    sessions: [],
    min_grade: "B",
    alert_min_grade: "B",
    daily_setup_cap: 0,
  };
  const now = Date.parse("2026-02-02T12:00:00Z");
  const signal = (instrument: string) => ({
    id: `id-${instrument}`,
    detected_at: new Date(now - 60_000).toISOString(),
    instrument,
    grade: "A" as const,
    trading_session: null,
  });

  it("[INVARIANT] Wave 0 stays eligible with no explicit preference", () => {
    for (const symbol of WAVE0_SYMBOLS) {
      expect(baseEligibility(signal(symbol), settings, "feed", now).eligible).toBe(true);
    }
  });

  it("[INVARIANT] a newly promoted pair does NOT auto-opt-in existing users", () => {
    for (const symbol of WAVE1_SYMBOLS) {
      expect(baseEligibility(signal(symbol), settings, "feed", now)).toEqual({
        eligible: false,
        reason: "instrument_filtered",
      });
    }
  });

  it("[UNIT] an explicit preference is still honoured verbatim", () => {
    const opted = { ...settings, instruments: ["USDJPY"] };
    expect(baseEligibility(signal("USDJPY"), opted, "feed", now).eligible).toBe(true);
    expect(baseEligibility(signal("EURUSD"), opted, "feed", now).eligible).toBe(false);
  });
});
