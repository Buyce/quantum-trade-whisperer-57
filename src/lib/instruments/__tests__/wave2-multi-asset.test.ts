/**
 * Wave 2 multi-asset foundation.
 *
 * These tests assert the REFUSALS. The value of this pass is not that four new
 * instruments exist; it is that none of them can be measured, sized, published or
 * executed on assumptions borrowed from FX.
 */
import { describe, expect, it } from "vitest";

import {
  INSTRUMENT_DEFINITIONS,
  WAVE0_SYMBOLS,
  WAVE2_SYMBOLS,
  assetClassOf,
  contractSpecs,
  priceUnitOf,
  spreadFloors,
} from "../registry";
import { describeDistance, fxPipSize, spreadToAtr, tickValue } from "../price-units";
import {
  MARKET_CALENDARS,
  calendarForAssetClass,
  calendarUsable,
  marketStateAt,
  quoteWithinWindow,
} from "../calendars";
import { correlatedExposureCount, correlationGroupOf, groupExposure } from "../correlation";
import { assessNewsRisk, newsFamiliesOf } from "../news-risk";
import { evaluateSpec, proposeCandidates } from "../discovery.server";
import { costTotal, perInstrumentCost, projectCapacity } from "@/lib/telemetry/capacity-projection";
import { spreadMetrics } from "@/lib/telemetry/sampler";
import { assetManifest, shadowBlockers } from "@/lib/scanner/manifests/asset-strategy";
import { INSTRUMENTS } from "@/lib/scanner/types";
import { ALL_INSTRUMENTS } from "@/lib/db-types";

const WAVE2 = ["XAGUSD", "USOIL", "UKOIL", "NAS100"];

describe("wave 2 registry", () => {
  it("[INVARIANT] admits exactly the four Wave 2 instruments, and nothing else moves", () => {
    expect([...WAVE2_SYMBOLS]).toEqual(WAVE2);
    // Wave 0 remains the scan universe, the settings list and the empty-preference
    // default. A definition is not an activation.
    expect([...INSTRUMENTS]).toEqual([...WAVE0_SYMBOLS]);
    expect(ALL_INSTRUMENTS).toEqual([...WAVE0_SYMBOLS]);
  });

  it("[INVARIANT] no Wave 2 instrument has a stop floor or a guessed contract size", () => {
    const floors = spreadFloors();
    const specs = contractSpecs();
    for (const symbol of WAVE2) {
      expect(floors[symbol]).toBeUndefined();
      // Absent, not present-with-a-guess: sizing must refuse rather than mis-size.
      expect(specs[symbol]).toBeUndefined();
      const d = INSTRUMENT_DEFINITIONS.find((x) => x.symbol === symbol)!;
      expect(d.contractSize).toBeNull();
      expect(d.lotStep).toBeNull();
      expect(d.minLot).toBeNull();
      expect(d.spreadFloor).toBeNull();
    }
  });

  it("[UNIT] classifies each new instrument and its reporting unit", () => {
    expect(assetClassOf("XAGUSD")).toBe("metal");
    expect(assetClassOf("USOIL")).toBe("energy");
    expect(assetClassOf("UKOIL")).toBe("energy");
    expect(assetClassOf("NAS100")).toBe("index");
    expect(priceUnitOf("NAS100")).toBe("index_point");
    expect(priceUnitOf("EURUSD")).toBe("pip");
    expect(priceUnitOf("XAUUSD")).toBe("price");
  });
});

describe("price units", () => {
  it("[INVARIANT] a pip is an FX concept only", () => {
    expect(fxPipSize({ symbol: "EURUSD", point: 0.00001, digits: 5 })).toBeCloseTo(0.0001, 10);
    expect(fxPipSize({ symbol: "USDJPY", point: 0.001, digits: 3 })).toBeCloseTo(0.01, 10);
    for (const symbol of ["XAGUSD", "USOIL", "NAS100", "XAUUSD"]) {
      expect(fxPipSize({ symbol, point: 0.01, digits: 2 })).toBeNull();
    }
  });

  it("[UNIT] reports index distance in index points and never in pips", () => {
    const report = describeDistance(12.5, {
      symbol: "NAS100",
      point: 0.1,
      tickSize: 0.1,
      digits: 1,
    });
    expect(report.pips).toBeNull();
    expect(report.indexPoints).toBe(12.5);
    expect(report.points).toBe(125);
    expect(report.ticks).toBe(125);
  });

  it("[INVARIANT] refuses every derived unit when the broker unit is unknown", () => {
    const report = describeDistance(0.5, { symbol: "USOIL", point: null, digits: null });
    expect(report.points).toBeNull();
    expect(report.ticks).toBeNull();
    expect(report.pips).toBeNull();
    expect(report.refusals).toContain("broker point unknown");
    expect(tickValue({ contractSize: null, tickSize: 0.01 })).toBeNull();
    expect(tickValue({ contractSize: 1000, tickSize: null })).toBeNull();
    expect(tickValue({ contractSize: 1000, tickSize: 0.01 })).toBe(10);
  });

  it("[UNIT] spread-to-ATR is the cross-asset comparable and refuses a null ATR", () => {
    expect(spreadToAtr(0.5, 5)).toBe(0.1);
    expect(spreadToAtr(0.5, null)).toBeNull();
    expect(spreadToAtr(0.5, 0)).toBeNull();
  });

  it("[INVARIANT] the sampler stops claiming pips for non-FX instruments", () => {
    const gold = spreadMetrics({
      bid: 2000,
      ask: 2000.3,
      point: 0.01,
      digits: 2,
      assetClass: "metal",
      atr: 6,
    });
    expect(gold.spreadPips).toBeNull();
    expect(gold.spreadPoints).toBe(30);
    // Unknown asset class keeps the pre-Wave-2 behaviour exactly.
    const legacy = spreadMetrics({ bid: 2000, ask: 2000.3, point: 0.01, digits: 2, atr: 6 });
    expect(legacy.spreadPips).toBe(30);
  });
});

describe("market calendars", () => {
  it("[INVARIANT] FX and metal keep the frozen Wave 0 week", () => {
    for (const key of ["fx_spot", "metal_spot"]) {
      const cal = MARKET_CALENDARS.find((c) => c.key === key)!;
      expect(cal.weekClose).toEqual({ day: 5, hour: 21 });
      expect(cal.weekOpen).toEqual({ day: 0, hour: 21 });
      expect(cal.dailyBreaks).toEqual([]);
      expect(calendarUsable(cal).usable).toBe(true);
    }
  });

  it("[INVARIANT] venue-local calendars cannot authorise a measurement", () => {
    for (const assetClass of ["energy", "index"] as const) {
      const cal = calendarForAssetClass(assetClass)!;
      const verdict = calendarUsable(cal);
      expect(verdict.usable).toBe(false);
      expect(verdict.reason).toContain("venue-local");
    }
  });

  it("[UNIT] reports a weekend and a daily break as closed, not as a failure", () => {
    const fx = calendarForAssetClass("fx")!;
    // Saturday.
    expect(marketStateAt(fx, new Date("2026-08-22T10:00:00Z")).state).toBe("closed_weekend");
    expect(marketStateAt(fx, new Date("2026-08-25T10:00:00Z")).state).toBe("open");

    const energy = calendarForAssetClass("energy")!;
    expect(marketStateAt(energy, new Date("2026-08-25T21:30:00Z")).state).toBe("closed_break");
  });

  it("[UNIT] records a dated holiday closure", () => {
    const cal = { ...calendarForAssetClass("index")!, holidays: ["2026-08-25"] };
    const verdict = marketStateAt(cal, new Date("2026-08-25T15:00:00Z"));
    expect(verdict.state).toBe("closed_holiday");
    expect(verdict.calendarVersion).toBe(1);
  });

  it("[INVARIANT] a quote carried across a break is stale, not fresh", () => {
    const energy = calendarForAssetClass("energy")!;
    const at = new Date("2026-08-25T22:30:00Z");
    // Broker timestamp from before the 21:00-22:00 break: the window reopened, so
    // this price belongs to the previous window however recent it looks.
    const carried = quoteWithinWindow({
      cal: energy,
      at,
      sourceTime: new Date("2026-08-25T20:59:00Z"),
    });
    expect(carried.usable).toBe(false);
    expect(carried.reason).toContain("predates the current trading window");

    const fresh = quoteWithinWindow({
      cal: energy,
      at,
      sourceTime: new Date("2026-08-25T22:29:30Z"),
    });
    expect(fresh.usable).toBe(true);

    const noStamp = quoteWithinWindow({ cal: energy, at, sourceTime: null });
    expect(noStamp.usable).toBe(false);
  });
});

describe("alias discovery", () => {
  const inventory = ["EURUSD", "XAGUSD.r", "XAGUSD", "USOIL", "WTI", "NAS100", "UKOIL"];

  it("[UNIT] treats broker suffix noise as one instrument", () => {
    expect(proposeCandidates("XAGUSD", inventory)).toEqual(["XAGUSD.r"]);
  });

  it("[INVARIANT] two distinct tickers are ambiguous, not a best guess", () => {
    const candidates = proposeCandidates("USOIL", inventory);
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates).toContain("USOIL");
    expect(candidates).toContain("WTI");
  });

  it("[INVARIANT] an absent instrument is missing, never defaulted", () => {
    expect(proposeCandidates("NAS100", ["EURUSD", "XAUUSD"])).toEqual([]);
  });

  it("[INVARIANT] a partial specification is unusable", () => {
    const verdict = evaluateSpec("NAS100", { digits: 1, point: 0.1 });
    expect(verdict.ok).toBe(false);
    expect(verdict.outcome).toBe("spec_unusable");
    expect(verdict.reason).toContain("contractSize");
  });

  it("[INVARIANT] refuses a close-only or disabled trade mode", () => {
    const verdict = evaluateSpec("XAGUSD", {
      digits: 3,
      point: 0.001,
      tickSize: 0.001,
      contractSize: 5000,
      minVolume: 0.01,
      volumeStep: 0.01,
      tradeMode: "CLOSE_ONLY",
    });
    expect(verdict.outcome).toBe("trade_mode_unusable");
  });

  it("[INVARIANT] refuses a settlement currency the conversion route did not plan for", () => {
    const verdict = evaluateSpec("NAS100", {
      digits: 1,
      point: 0.1,
      tickSize: 0.1,
      contractSize: 1,
      minVolume: 0.1,
      volumeStep: 0.1,
      profitCurrency: "EUR",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("EUR");
  });

  it("[UNIT] accepts a complete specification as a CANDIDATE only", () => {
    const verdict = evaluateSpec("XAGUSD", {
      digits: 3,
      point: 0.001,
      tickSize: 0.001,
      contractSize: 5000,
      minVolume: 0.01,
      volumeStep: 0.01,
      tradeMode: "FULL",
      profitCurrency: "USD",
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.outcome).toBe("candidate");
  });
});

describe("capacity, correlation and news risk", () => {
  it("[UNIT] projects Wave 2 cost and refuses activation without headroom", () => {
    const cost = perInstrumentCost({ scansPerDay: 96, timeframes: 3, conversionLegs: 1 });
    expect(cost.samplerQuotes).toBe(96);
    expect(costTotal(cost)).toBe(96 + 288 + 1 + 1 + 1);

    const tight = projectCapacity({
      currentInstruments: 3,
      newInstruments: 4,
      budget: 288,
      cost,
    });
    expect(tight.withinBudget).toBe(false);
    expect(tight.reason).toContain("exceeds the usable budget");

    const roomy = projectCapacity({
      currentInstruments: 3,
      newInstruments: 4,
      budget: 10_000,
      cost,
    });
    expect(roomy.withinBudget).toBe(true);
    expect(roomy.incrementalRequestsPerDay).toBe(4 * costTotal(cost));
  });

  it("[INVARIANT] correlated instruments count as one exposure", () => {
    expect(correlationGroupOf("XAGUSD")).toBe("metals_usd");
    expect(correlationGroupOf("XAUUSD")).toBe("metals_usd");
    expect(correlationGroupOf("EURUSD")).toBe("EURUSD");
    expect(correlatedExposureCount(["XAUUSD", "XAGUSD", "USOIL", "UKOIL"])).toBe(2);

    const grouped = groupExposure([
      { instrument: "USOIL", risk: 100 },
      { instrument: "UKOIL", risk: 80 },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.worstCaseRisk).toBe(180);
  });

  it("[INVARIANT] unknown news coverage suppresses, it does not clear", () => {
    expect(newsFamiliesOf("USOIL")).toContain("energy_inventory");
    expect(newsFamiliesOf("EURUSD")).toContain("central_bank");

    const unsourced = assessNewsRisk({ symbol: "USOIL" });
    expect(unsourced.unknown).toBe(true);
    expect(unsourced.suppressNewEntries).toBe(true);
    expect(unsourced.reason).toContain("energy_inventory");

    const covered = assessNewsRisk({
      symbol: "USOIL",
      sourcedFamilies: ["energy_inventory", "opec_supply", "us_macro"],
    });
    expect(covered.suppressNewEntries).toBe(false);
  });
});

describe("strategy portability", () => {
  it("[INVARIANT] FX and metal manifests describe shipped behaviour", () => {
    expect(assetManifest("fx")!.readyForShadow).toBe(true);
    expect(assetManifest("metal")!.readyForShadow).toBe(true);
  });

  it("[INVARIANT] energy and index may not run strategy code yet", () => {
    for (const assetClass of ["energy", "index"] as const) {
      expect(assetManifest(assetClass)!.readyForShadow).toBe(false);
      const blockers = shadowBlockers(assetClass);
      expect(blockers.length).toBeGreaterThan(0);
      expect(blockers.join(" ")).toContain("stop_buffer_from_spread_floor");
    }
  });
});
