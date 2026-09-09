import { describe, expect, it } from "vitest";

import {
  SAME_BET_COOLDOWN_DEFAULT_MINUTES,
  SAME_BET_LIMIT_DEFAULT,
  SAME_BET_LIMIT_MAX,
  clampSameBetCooldownMinutes,
  clampSameBetLimit,
  evaluateSameBetCooldown,
  evaluateSameBetLimit,
  isSameBet,
  type ClosedLoss,
} from "@/lib/delivery/correlated-cluster";

const NOW = Date.parse("2026-09-09T12:00:00Z");

describe("same-bet limit", () => {
  it("[UNIT] the limit is always 1 to 3 — never off, never unbounded", () => {
    expect(clampSameBetLimit(null)).toBe(SAME_BET_LIMIT_DEFAULT);
    expect(clampSameBetLimit(0)).toBe(1);
    expect(clampSameBetLimit(-4)).toBe(1);
    expect(clampSameBetLimit(2)).toBe(2);
    expect(clampSameBetLimit(9)).toBe(SAME_BET_LIMIT_MAX);
    expect(clampSameBetLimit("not a number")).toBe(SAME_BET_LIMIT_DEFAULT);
  });

  it("[UNIT] one live order on the same pair and side reaches the default limit", () => {
    const held = [{ instrument: "XAUUSD", direction: "short" }];
    expect(evaluateSameBetLimit({ instrument: "XAUUSD", direction: "short" }, held, 1).reached).toBe(
      true,
    );
    expect(evaluateSameBetLimit({ instrument: "XAUUSD", direction: "short" }, held, 2).reached).toBe(
      false,
    );
  });

  it("[UNIT] the other side, or another instrument, is a different bet", () => {
    const held = [{ instrument: "XAUUSD", direction: "short" }];
    expect(evaluateSameBetLimit({ instrument: "XAUUSD", direction: "long" }, held, 1).reached).toBe(
      false,
    );
    expect(evaluateSameBetLimit({ instrument: "EURUSD", direction: "short" }, held, 1).reached).toBe(
      false,
    );
  });

  it("[INVARIANT] an unreadable instrument or direction is never counted as the same bet", () => {
    expect(isSameBet({ instrument: null, direction: "short" }, { instrument: "XAUUSD", direction: "short" })).toBe(
      false,
    );
    expect(
      isSameBet({ instrument: "XAUUSD", direction: "flat" }, { instrument: "XAUUSD", direction: "short" }),
    ).toBe(false);
    expect(
      evaluateSameBetLimit({ instrument: "XAUUSD", direction: "short" }, [
        { instrument: null, direction: null },
      ], 1).reached,
    ).toBe(false);
  });

  it("[BEHAVIOR] replays 2026-09-09: seven Gold shorts become one order at the default", () => {
    const held: { instrument: string; direction: string }[] = [];
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 7; i += 1) {
      const verdict = evaluateSameBetLimit(
        { instrument: "XAUUSD", direction: "short" },
        held,
        SAME_BET_LIMIT_DEFAULT,
      );
      if (verdict.reached) refused += 1;
      else {
        accepted += 1;
        held.push({ instrument: "XAUUSD", direction: "short" });
      }
    }
    expect(accepted).toBe(1);
    expect(refused).toBe(6);
  });
});

describe("same-bet cool-off after a broker-confirmed loss", () => {
  const loss = (minutesAgo: number): ClosedLoss => ({
    instrument: "XAUUSD",
    direction: "short",
    exitAtMs: NOW - minutesAgo * 60_000,
  });

  it("[UNIT] only the offered windows are legal", () => {
    expect(clampSameBetCooldownMinutes(null)).toBe(SAME_BET_COOLDOWN_DEFAULT_MINUTES);
    expect(clampSameBetCooldownMinutes(0)).toBe(0);
    expect(clampSameBetCooldownMinutes(30)).toBe(30);
    expect(clampSameBetCooldownMinutes(45)).toBe(SAME_BET_COOLDOWN_DEFAULT_MINUTES);
    expect(clampSameBetCooldownMinutes(9999)).toBe(SAME_BET_COOLDOWN_DEFAULT_MINUTES);
  });

  it("[UNIT] a recent loss on that bet refuses, an expired one does not", () => {
    const bet = { instrument: "XAUUSD", direction: "short" };
    expect(evaluateSameBetCooldown(bet, [loss(10)], NOW, 60).active).toBe(true);
    expect(evaluateSameBetCooldown(bet, [loss(90)], NOW, 60).active).toBe(false);
  });

  it("[UNIT] the newest loss on the bet sets the resume time", () => {
    const bet = { instrument: "XAUUSD", direction: "short" };
    const verdict = evaluateSameBetCooldown(bet, [loss(200), loss(5)], NOW, 60);
    expect(verdict.active).toBe(true);
    expect(verdict.resumesAtMs).toBe(NOW - 5 * 60_000 + 60 * 60_000);
  });

  it("[UNIT] switched off never refuses", () => {
    expect(
      evaluateSameBetCooldown({ instrument: "XAUUSD", direction: "short" }, [loss(1)], NOW, 0)
        .active,
    ).toBe(false);
  });

  it("[INVARIANT] a loss on another bet, or with an unreadable close, never refuses", () => {
    const bet = { instrument: "XAUUSD", direction: "short" };
    expect(evaluateSameBetCooldown(bet, [{ ...loss(5), direction: "long" }], NOW, 60).active).toBe(
      false,
    );
    expect(evaluateSameBetCooldown(bet, [{ ...loss(5), instrument: null }], NOW, 60).active).toBe(
      false,
    );
    expect(evaluateSameBetCooldown(bet, [{ ...loss(5), exitAtMs: Number.NaN }], NOW, 60).active).toBe(
      false,
    );
  });
});
