import { describe, expect, it } from "vitest";
import {
  brakesConfigured,
  evaluateBrakes,
  isoWeekStartUtc,
  readBrakeLimits,
  summariseRealised,
  type BrakeLimits,
  type ClosedTrade,
} from "../brakes";

const OFF: BrakeLimits = {
  enabled: false,
  dailyLossPercent: 0,
  weeklyLossPercent: 0,
  consecutiveLosses: 0,
  maxDrawdownPercent: 0,
};

const on = (over: Partial<BrakeLimits>): BrakeLimits => ({ ...OFF, enabled: true, ...over });

// Wednesday 2026-09-02T12:00:00Z
const NOW = Date.parse("2026-09-02T12:00:00.000Z");

const trade = (iso: string, net: number): ClosedTrade => ({
  exitAtMs: Date.parse(iso),
  net,
  currency: "EUR",
});

describe("readBrakeLimits", () => {
  it("is off unless the owner switched it on", () => {
    expect(brakesConfigured(readBrakeLimits({}))).toBe(false);
    expect(
      brakesConfigured(readBrakeLimits({ daily_loss_limit_percent: 3 })),
    ).toBe(false);
  });

  it("is still off when switched on with no limit set", () => {
    expect(brakesConfigured(readBrakeLimits({ drawdown_brakes_enabled: true }))).toBe(false);
  });

  it("clamps nonsense to disabled and caps percentages at 100", () => {
    const limits = readBrakeLimits({
      drawdown_brakes_enabled: true,
      daily_loss_limit_percent: -5,
      weekly_loss_limit_percent: 9999,
      consecutive_loss_limit: 3.7,
      max_drawdown_percent: Number.NaN,
    });
    expect(limits.dailyLossPercent).toBe(0);
    expect(limits.weeklyLossPercent).toBe(100);
    expect(limits.consecutiveLosses).toBe(3);
    expect(limits.maxDrawdownPercent).toBe(0);
  });
});

describe("summariseRealised", () => {
  it("counts the UTC day and the ISO week separately", () => {
    const totals = summariseRealised(
      [
        trade("2026-08-31T09:00:00Z", -100), // Monday, this week
        trade("2026-09-01T09:00:00Z", -50), // Tuesday, this week
        trade("2026-09-02T09:00:00Z", -25), // today
        trade("2026-08-28T09:00:00Z", -900), // last week: excluded
      ],
      NOW,
    );
    expect(totals.dayUtc).toBe("2026-09-02");
    expect(totals.dayRealized).toBe(-25);
    expect(totals.weekStartUtc).toBe("2026-08-31");
    expect(totals.weekRealized).toBe(-175);
    expect(totals.sample).toBe(4);
  });

  it("counts the consecutive losing run backwards from the last close", () => {
    const totals = summariseRealised(
      [
        trade("2026-09-02T06:00:00Z", -10),
        trade("2026-09-02T07:00:00Z", 40),
        trade("2026-09-02T08:00:00Z", -10),
        trade("2026-09-02T09:00:00Z", -10),
      ],
      NOW,
    );
    expect(totals.consecutiveLosses).toBe(2);
  });

  it("treats a break-even close as ending the run without counting as a loss", () => {
    const totals = summariseRealised(
      [trade("2026-09-02T08:00:00Z", -10), trade("2026-09-02T09:00:00Z", 0)],
      NOW,
    );
    expect(totals.consecutiveLosses).toBe(0);
  });

  it("ignores rows with an unusable timestamp or amount", () => {
    const totals = summariseRealised(
      [{ exitAtMs: Number.NaN, net: -1000, currency: null }, trade("2026-09-02T09:00:00Z", -10)],
      NOW,
    );
    expect(totals.sample).toBe(1);
    expect(totals.dayRealized).toBe(-10);
  });
});

describe("isoWeekStartUtc", () => {
  it("puts Sunday in the week that started the previous Monday", () => {
    expect(isoWeekStartUtc(Date.parse("2026-09-06T23:00:00Z"))).toBe("2026-08-31");
    expect(isoWeekStartUtc(Date.parse("2026-09-07T00:00:00Z"))).toBe("2026-09-07");
  });
});

describe("evaluateBrakes", () => {
  const totals = summariseRealised([trade("2026-09-02T09:00:00Z", -400)], NOW);

  it("passes when nothing is configured", () => {
    expect(evaluateBrakes(OFF, { totals, equity: 10_000, peakEquity: 10_000 }, NOW).paused).toBe(
      false,
    );
  });

  it("refuses when the closed-trade history could not be read", () => {
    const v = evaluateBrakes(
      on({ dailyLossPercent: 3 }),
      { totals: null, equity: 10_000, peakEquity: 10_000 },
      NOW,
    );
    expect(v.paused).toBe(true);
    expect(v.reason).toBe("risk_state_unmeasured");
    expect(v.resumeBoundary).toBe("owner");
  });

  it("refuses when the broker reported no equity to measure a percentage against", () => {
    const v = evaluateBrakes(
      on({ dailyLossPercent: 3 }),
      { totals, equity: null, peakEquity: null },
      NOW,
    );
    expect(v.paused).toBe(true);
    expect(v.reason).toBe("risk_state_unmeasured");
  });

  it("does not need equity when only the consecutive-loss brake is set", () => {
    const run = summariseRealised(
      [
        trade("2026-09-02T07:00:00Z", -10),
        trade("2026-09-02T08:00:00Z", -10),
        trade("2026-09-02T09:00:00Z", -10),
      ],
      NOW,
    );
    const v = evaluateBrakes(
      on({ consecutiveLosses: 3 }),
      { totals: run, equity: null, peakEquity: null },
      NOW,
    );
    expect(v.paused).toBe(true);
    expect(v.reason).toBe("consecutive_loss_limit");
    expect(v.resumeBoundary).toBe("next_utc_day");
  });

  it("pauses on the daily loss limit and resumes at the next UTC midnight", () => {
    const v = evaluateBrakes(
      on({ dailyLossPercent: 3 }),
      { totals, equity: 10_000, peakEquity: 10_000 },
      NOW,
    );
    expect(v.paused).toBe(true);
    expect(v.reason).toBe("daily_loss_limit");
    expect(v.resumeAfterMs).toBe(Date.parse("2026-09-03T00:00:00.000Z"));
  });

  it("leaves a loss under the limit alone", () => {
    const v = evaluateBrakes(
      on({ dailyLossPercent: 5 }),
      { totals, equity: 10_000, peakEquity: 10_000 },
      NOW,
    );
    expect(v.paused).toBe(false);
  });

  it("never brakes on a profitable day", () => {
    const green = summariseRealised([trade("2026-09-02T09:00:00Z", 5_000)], NOW);
    expect(
      evaluateBrakes(on({ dailyLossPercent: 1 }), { totals: green, equity: 10_000, peakEquity: 10_000 }, NOW)
        .paused,
    ).toBe(false);
  });

  it("reports the weekly limit ahead of the daily one when both are breached", () => {
    const week = summariseRealised(
      [trade("2026-08-31T09:00:00Z", -500), trade("2026-09-02T09:00:00Z", -400)],
      NOW,
    );
    const v = evaluateBrakes(
      on({ dailyLossPercent: 3, weeklyLossPercent: 6 }),
      { totals: week, equity: 10_000, peakEquity: 10_000 },
      NOW,
    );
    expect(v.reason).toBe("weekly_loss_limit");
    expect(v.resumeAfterMs).toBe(Date.parse("2026-09-07T00:00:00.000Z"));
  });

  it("brakes on equity drawdown against the observed peak, and needs the owner to lift it", () => {
    const v = evaluateBrakes(
      on({ maxDrawdownPercent: 10 }),
      { totals, equity: 8_900, peakEquity: 10_000 },
      NOW,
    );
    expect(v.paused).toBe(true);
    expect(v.reason).toBe("equity_drawdown_limit");
    expect(v.resumeAfterMs).toBeNull();
    expect(v.detail).toContain("highest equity P-Trades has observed");
  });

  it("makes no drawdown claim before a higher equity was ever observed", () => {
    const v = evaluateBrakes(
      on({ maxDrawdownPercent: 10 }),
      { totals, equity: 8_900, peakEquity: 8_900 },
      NOW,
    );
    expect(v.paused).toBe(false);
  });
});
