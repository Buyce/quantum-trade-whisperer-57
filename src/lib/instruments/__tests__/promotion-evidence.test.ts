import { describe, expect, it } from "vitest";

import { parseSampleEvidence } from "../promotion.server";

describe("promotion sample evidence parsing", () => {
  it("[UNIT] a complete aggregate row is carried through unchanged", () => {
    const row = parseSampleEvidence({
      instrument: "GBPUSD",
      trading_days: 12,
      valid_samples: 470,
      invalid_samples: 373,
      covered_sessions: ["london", "tokyo"],
      observed_provider_symbols: ["GBPUSD"],
      missingness_pct: 44.2467,
    });
    expect(row).toEqual({
      instrument: "GBPUSD",
      trading_days: 12,
      valid_samples: 470,
      invalid_samples: 373,
      covered_sessions: ["london", "tokyo"],
      observed_provider_symbols: ["GBPUSD"],
      missingness_pct: 44.2467,
    });
  });

  it("[INVARIANT] an unmeasurable missingness stays null rather than becoming 0%", () => {
    const row = parseSampleEvidence({
      instrument: "USDCHF",
      trading_days: 3,
      valid_samples: 10,
      invalid_samples: 0,
      covered_sessions: [],
      observed_provider_symbols: [],
      missingness_pct: null,
    });
    expect(row?.missingness_pct).toBeNull();
  });

  it("[INVARIANT] a row with no instrument is discarded, never guessed at", () => {
    expect(parseSampleEvidence({ trading_days: 9 })).toBeNull();
    expect(parseSampleEvidence(null)).toBeNull();
    expect(parseSampleEvidence("GBPUSD")).toBeNull();
  });

  it("[INVARIANT] non-string session or symbol entries are dropped, not coerced", () => {
    const row = parseSampleEvidence({
      instrument: "EURUSD",
      covered_sessions: ["london", 3, null],
      observed_provider_symbols: [null, "EURUSD"],
    });
    expect(row?.covered_sessions).toEqual(["london"]);
    expect(row?.observed_provider_symbols).toEqual(["EURUSD"]);
    expect(row?.valid_samples).toBe(0);
  });
});
