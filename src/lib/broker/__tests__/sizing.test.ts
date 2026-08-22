/**
 * Prompt 12 blocking tests: broker specs must change sizing only where the
 * broker actually told us something, and model 1 must stay byte-identical
 * until model 2 is explicitly promoted.
 */
import { describe, expect, it } from "vitest";
import { calculateRisk, type RiskProfile } from "@/lib/risk";
import { rowFromSpecification, specFromRow, staticSpec, type BrokerSpecRow } from "../specs";
import { compareSizing } from "../sizing-compare";
import { resolveSizing } from "../sizing.server";

const profile: RiskProfile = {
  accountEquity: 10_000,
  accountCurrency: "USD",
  riskPerTradePercent: 1,
  maxPositionSize: 100,
  leverage: 100,
  maxStopLossPercent: 5,
};

const setup = { instrument: "XAUUSD", entryPrice: 2400, stopLoss: 2390, finalTargetR: 2 };

function brokerRow(overrides: Partial<BrokerSpecRow> = {}): BrokerSpecRow {
  return {
    symbol: "XAUUSD",
    contract_size: 100,
    tick_size: 0.01,
    tick_value: 1,
    volume_min: 0.01,
    volume_max: 100,
    volume_step: 0.01,
    volume_limit: null,
    stops_level: 0,
    freeze_level: 0,
    digits: 2,
    point: 0.01,
    point_source: "derived_from_digits",
    base_currency: "XAU",
    profit_currency: "USD",
    margin_currency: "USD",
    trade_mode: "SYMBOL_TRADE_MODE_FULL",
    calc_mode: "SYMBOL_CALC_MODE_CFDLEVERAGE",
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("broker spec parsing", () => {
  it("[INVARIANT] rejects a partial spec instead of guessing the missing fields", () => {
    expect(specFromRow(brokerRow({ contract_size: null }))).toBeNull();
    expect(specFromRow(brokerRow({ volume_step: null }))).toBeNull();
    expect(specFromRow(brokerRow({ profit_currency: null }))).toBeNull();
  });

  it("[INVARIANT] keeps absent broker fields null rather than defaulting them", () => {
    const row = rowFromSpecification("EURUSD", { contractSize: 100000, volumeStep: 0.01 });
    expect(row.stops_level).toBeNull();
    expect(row.tick_size).toBeNull();
    expect(row.volume_limit).toBeNull();
  });

  it("[INVARIANT] labels the static table so it can never read as broker-confirmed", () => {
    const spec = staticSpec("XAUUSD");
    expect(spec?.source).toBe("static_v1");
    expect(spec?.asOf).toBeNull();
    expect(spec?.stopsLevel).toBeNull();
  });
});

describe("calculateRisk with broker specs", () => {
  it("[UNIT] matches model 1 when the broker confirms the same contract facts", () => {
    const v1 = calculateRisk(setup, profile);
    const v2 = calculateRisk(setup, profile, {}, { spec: specFromRow(brokerRow())! });
    expect(v1.ok && v2.ok).toBe(true);
    if (!v1.ok || !v2.ok) return;
    expect(v2.lots).toBeCloseTo(v1.lots, 10);
    expect(v2.specSource).toBe("broker");
    expect(v2.sizingModelVersion).toBe(2);
    expect(v1.sizingModelVersion).toBe(1);
    expect(v1.specSource).toBe("static_v1");
  });

  it("[INVARIANT] refuses to size when the stop is inside the broker's stops level", () => {
    // 5000 points x 0.01 point size = 50 in price, wider than the 10 stop.
    const spec = specFromRow(brokerRow({ stops_level: 5000 }))!;
    const res = calculateRisk(setup, profile, {}, { spec });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("below_stops_level");
  });

  it("[INVARIANT] converts stops level with the point size, never with the tick size", () => {
    // Tick size is 25x the point here: using it would overstate the minimum
    // stop distance by 25x and refuse a perfectly valid stop.
    const spec = specFromRow(brokerRow({ stops_level: 500, tick_size: 0.25 }))!;
    expect(spec.point).toBe(0.01);
    const res = calculateRisk(setup, profile, {}, { spec });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minStopDistance).toBeCloseTo(5, 10);
  });

  it("[INVARIANT] derives the point size from digits and never from the tick size", () => {
    const row = rowFromSpecification("EURUSD", {
      contractSize: 100_000,
      volumeStep: 0.01,
      tickSize: 0.00005,
      digits: 5,
    });
    expect(row.point).toBeCloseTo(0.00001, 12);
    expect(row.point_source).toBe("derived_from_digits");
  });

  it("[INVARIANT] prefers an explicit broker point field over the derived one", () => {
    const row = rowFromSpecification("XAUUSD", {
      contractSize: 100,
      volumeStep: 0.01,
      digits: 3,
      point: 0.01,
    });
    expect(row.point).toBe(0.01);
    expect(row.point_source).toBe("broker_point");
  });

  it("[INVARIANT] makes no stops-level claim when the broker omitted it", () => {
    const spec = specFromRow(brokerRow({ stops_level: null }))!;
    const res = calculateRisk(setup, profile, {}, { spec });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minStopDistance).toBeNull();
  });

  it("[UNIT] applies the broker volume ceiling and flags it separately", () => {
    const spec = specFromRow(brokerRow({ volume_max: 0.05 }))!;
    const res = calculateRisk(
      { ...setup, stopLoss: 2399.9 },
      profile,
      {},
      { spec },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lots).toBeLessThanOrEqual(0.05);
    expect(res.cappedByBrokerVolume).toBe(true);
  });

  it("[INVARIANT] reports stale broker specs and stale quotes instead of sizing", () => {
    const spec = specFromRow(brokerRow())!;
    const stale = calculateRisk(setup, profile, {}, { spec, specStale: true });
    expect(stale.ok === false && stale.reason === "stale_spec").toBe(true);
    const staleQuote = calculateRisk(setup, profile, {}, { quoteStale: true });
    expect(staleQuote.ok === false && staleQuote.reason === "stale_quote").toBe(true);
  });

  it("[INVARIANT] labels margin as an estimate derived from notional and leverage", () => {
    const res = calculateRisk(setup, profile);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.marginBasis).toBe("notional_over_leverage");
    expect(res.marginEstimate).toBeCloseTo(res.notional / profile.leverage, 8);
    expect(res.marginRequired).toBe(res.marginEstimate);
  });
});

describe("dual-run resolution", () => {
  it("[INVARIANT] keeps model 1 authoritative until v2 is promoted", () => {
    const spec = specFromRow(brokerRow({ volume_max: 0.05 }))!;
    const wide = { ...setup, stopLoss: 2399.9 };
    const shadowOnly = resolveSizing(wide, profile, {}, { spec });
    expect(shadowOnly.authoritativeModel).toBe(1);
    expect(shadowOnly.divergence.diverged).toBe(true);

    const promoted = resolveSizing(wide, profile, {}, { spec, v2Promoted: true });
    expect(promoted.authoritativeModel).toBe(2);
    expect(promoted.authoritative).toBe(promoted.shadow);
  });

  it("[INVARIANT] never promotes a stale broker spec", () => {
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const spec = specFromRow(brokerRow({ fetched_at: old }))!;
    const res = resolveSizing(setup, profile, {}, { spec, v2Promoted: true });
    expect(res.authoritativeModel).toBe(1);
    expect(res.authoritative.ok).toBe(true);
  });

  it("[UNIT] reports identical runs as non-divergent", () => {
    const v1 = calculateRisk(setup, profile);
    expect(compareSizing(v1, v1).diverged).toBe(false);
  });
});
