/**
 * Execution-quality scoring and automatic cooldowns.
 *
 * The invariants under test are the honesty invariants: too little recorded
 * evidence means "not measured" (never a zero and never a pause), a dimension is
 * only ever judged against its own earlier norm, and a cooldown lifts itself so
 * the dimension is re-tested rather than condemned forever.
 */
import { describe, expect, it } from "vitest";

import {
  COOLDOWN_HOURS,
  MIN_NORM_CLOSED,
  MIN_RECENT_CLOSED,
  MIN_RECENT_DELIVERIES,
  NORM_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  evaluateCooldown,
  median,
  p90,
  scoreWindow,
  splitWindows,
  type ClosedExecution,
  type DeliveryOutcome,
} from "../quality";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-05T00:00:00Z");

const closed = (slippage: number | null, r: number | null): ClosedExecution => ({
  exitAtMs: NOW,
  slippagePrice: slippage,
  rVsPlan: r,
});

const delivery = (state: string, reason: string | null = null): DeliveryOutcome => ({
  enqueuedAtMs: NOW,
  state,
  rejectReason: reason,
});

describe("percentiles", () => {
  it("[UNIT] returns null for an empty sample instead of zero", () => {
    expect(median([])).toBeNull();
    expect(p90([])).toBeNull();
  });

  it("[UNIT] uses nearest rank for p90, not an average", () => {
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(median([1, 3, 5])).toBe(3);
  });
});

describe("scoreWindow", () => {
  it("[UNIT] marks a thin window as not measured and says why", () => {
    const score = scoreWindow(
      { closed: [closed(0.0001, 1)], deliveries: [] },
      RECENT_WINDOW_DAYS,
    );
    expect(score.measured).toBe(false);
    expect(score.unmeasuredReason).toContain(String(MIN_RECENT_CLOSED));
  });

  it("[INVARIANT] never treats unavailable slippage or R as zero", () => {
    const score = scoreWindow(
      { closed: Array.from({ length: MIN_RECENT_CLOSED }, () => closed(null, null)), deliveries: [] },
      RECENT_WINDOW_DAYS,
    );
    expect(score.measured).toBe(true);
    expect(score.slippageSample).toBe(0);
    expect(score.medianSlippage).toBeNull();
    expect(score.avgR).toBeNull();
  });

  it("[UNIT] counts margin refusals from the broker's own reason text", () => {
    const score = scoreWindow(
      {
        closed: Array.from({ length: MIN_RECENT_CLOSED }, () => closed(0.0002, 0.5)),
        deliveries: [delivery("rejected", "TRADE_RETCODE_NO_MONEY"), delivery("acknowledged")],
      },
      RECENT_WINDOW_DAYS,
    );
    expect(score.marginRefusals).toBe(1);
    expect(score.rejectedCount).toBe(1);
    expect(score.rejectRate).toBeCloseTo(0.5);
  });

  it("[UNIT] reports no reject rate at all when there were no deliveries", () => {
    const score = scoreWindow(
      { closed: Array.from({ length: MIN_RECENT_CLOSED }, () => closed(0.0002, 0.5)), deliveries: [] },
      RECENT_WINDOW_DAYS,
    );
    expect(score.rejectRate).toBeNull();
  });
});

describe("evaluateCooldown", () => {
  const measuredRecent = (slippage: number, deliveries: DeliveryOutcome[] = []) =>
    scoreWindow(
      {
        closed: Array.from({ length: MIN_RECENT_CLOSED }, () => closed(slippage, 0.1)),
        deliveries,
      },
      RECENT_WINDOW_DAYS,
    );
  const measuredNorm = (slippage: number, deliveries: DeliveryOutcome[] = []) =>
    scoreWindow(
      {
        closed: Array.from({ length: MIN_NORM_CLOSED }, () => closed(slippage, 0.1)),
        deliveries,
      },
      NORM_WINDOW_DAYS - RECENT_WINDOW_DAYS,
    );

  it("[UNIT] does not breach when the recent window is unmeasured", () => {
    const recent = scoreWindow({ closed: [closed(1, 1)], deliveries: [] }, RECENT_WINDOW_DAYS);
    expect(evaluateCooldown(recent, measuredNorm(0.0001), NOW).breached).toBe(false);
  });

  it("[UNIT] does not breach when there is no norm to breach", () => {
    const thinNorm = scoreWindow({ closed: [closed(0.0001, 1)], deliveries: [] }, 46);
    expect(evaluateCooldown(measuredRecent(0.01), thinNorm, NOW).breached).toBe(false);
  });

  it("[UNIT] breaches on slippage only against the dimension's own norm", () => {
    const verdict = evaluateCooldown(measuredRecent(0.001), measuredNorm(0.0001), NOW);
    expect(verdict.breached).toBe(true);
    expect(verdict.reason).toBe("slippage_breach");
    expect(verdict.observed).toBeCloseTo(0.001);
    expect(verdict.norm).toBeCloseTo(0.0001);
    expect(verdict.resumeAfterMs).toBe(NOW + COOLDOWN_HOURS * 60 * 60 * 1000);
  });

  it("[UNIT] does not breach when slippage is merely a little worse", () => {
    expect(evaluateCooldown(measuredRecent(0.00015), measuredNorm(0.0001), NOW).breached).toBe(
      false,
    );
  });

  it("[UNIT] breaches on reject rate once enough recent deliveries exist", () => {
    const recentDeliveries = [
      ...Array.from({ length: MIN_RECENT_DELIVERIES / 2 }, () => delivery("rejected", "invalid")),
      ...Array.from({ length: MIN_RECENT_DELIVERIES / 2 }, () => delivery("acknowledged")),
    ];
    const normDeliveries = Array.from({ length: 20 }, () => delivery("acknowledged"));
    const verdict = evaluateCooldown(
      measuredRecent(0.0001, recentDeliveries),
      measuredNorm(0.0001, normDeliveries),
      NOW,
    );
    expect(verdict.breached).toBe(true);
    expect(verdict.reason).toBe("reject_rate_breach");
  });

  it("[UNIT] ignores a bad reject rate on too few recent deliveries", () => {
    const verdict = evaluateCooldown(
      measuredRecent(0.0001, [delivery("rejected", "invalid")]),
      measuredNorm(0.0001, Array.from({ length: 20 }, () => delivery("acknowledged"))),
      NOW,
    );
    expect(verdict.breached).toBe(false);
  });
});

describe("splitWindows", () => {
  it("[UNIT] separates recent from norm and drops rows older than the norm window", () => {
    const rows = [
      { atMs: NOW - 1 * DAY },
      { atMs: NOW - (RECENT_WINDOW_DAYS + 1) * DAY },
      { atMs: NOW - (NORM_WINDOW_DAYS + 1) * DAY },
    ];
    const split = splitWindows(rows, NOW);
    expect(split.recent).toHaveLength(1);
    expect(split.norm).toHaveLength(1);
  });
});
