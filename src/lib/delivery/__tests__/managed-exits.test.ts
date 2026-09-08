/**
 * Managed-exit and exit-policy resolution invariants.
 *
 * These are the rules a customer's target choice and the demo position-management
 * pass must obey. Nothing here talks to a broker or a database.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXECUTION_POLICY,
  isManagedPolicy,
  POLICY_TARGET_RANK,
  resolveExitPolicy,
  targetForPolicy,
} from "../execution";
import {
  decideManagedPosition,
  decideManagedStep,
  managedPlan,
  roundDownToStep,
  type ManagedPositionFacts,
  type ManagedProgress,
} from "../manage-positions";

describe("resolveExitPolicy", () => {
  it("[INVARIANT] keeps a choice that sits inside the platform ceiling", () => {
    const r = resolveExitPolicy("single_exit_second_target", "single_exit_third_target");
    expect(r.policy).toBe("single_exit_second_target");
    expect(r.clamped).toBe(false);
  });

  it("[INVARIANT] reduces a deeper choice to the ceiling", () => {
    const r = resolveExitPolicy("single_exit_third_target", "single_exit_second_target");
    expect(r.policy).toBe("single_exit_second_target");
    expect(r.clamped).toBe(true);
  });

  it("[INVARIANT] falls back to the first target for unknown values on either side", () => {
    expect(resolveExitPolicy("nonsense", "also_nonsense").policy).toBe(DEFAULT_EXECUTION_POLICY);
  });

  it("[INVARIANT] offers the managed policy only when the ceiling names it exactly", () => {
    expect(resolveExitPolicy("partial_tp1_runner_tp2", "single_exit_third_target").policy).toBe(
      "single_exit_third_target",
    );
    expect(
      isManagedPolicy(resolveExitPolicy("partial_tp1_runner_tp2", "partial_tp1_runner_tp2").policy),
    ).toBe(true);
  });
});

describe("targetForPolicy", () => {
  const plan = { tp1: 10, tp2: 20, tp3: null };

  it("[INVARIANT] submits the target the policy names", () => {
    expect(targetForPolicy("single_exit_first_target", plan)).toBe(10);
    expect(targetForPolicy("single_exit_second_target", plan)).toBe(20);
  });

  it("[INVARIANT] refuses rather than falling back to a nearer target", () => {
    expect(targetForPolicy("single_exit_third_target", plan)).toBeNull();
  });

  it("[INVARIANT] submits the managed policy's single exit at the second target", () => {
    expect(POLICY_TARGET_RANK["partial_tp1_runner_tp2"]).toBe(2);
    expect(targetForPolicy("partial_tp1_runner_tp2", plan)).toBe(20);
  });
});

const facts = (over: Partial<ManagedPositionFacts> = {}): ManagedPositionFacts => ({
  side: "long",
  openPrice: 100,
  currentPrice: 100.5,
  volume: 1,
  firstTarget: 101,
  volumeStep: 0.01,
  minVolume: 0.01,
  currentStop: 99,
  ...over,
});

describe("decideManagedPosition", () => {
  it("[INVARIANT] does nothing before the first target is reached", () => {
    const d = decideManagedPosition(facts(), false, false);
    expect(d.closeVolume).toBeNull();
    expect(d.undecidable).toBe(false);
  });

  it("[INVARIANT] closes half, rounded down to the broker's volume step", () => {
    const d = decideManagedPosition(facts({ currentPrice: 101, volume: 0.07 }), false, false);
    expect(d.closeVolume).toBe(0.03);
  });

  it("[INVARIANT] refuses to split a position the broker's minimum volume cannot split", () => {
    const d = decideManagedPosition(
      facts({ currentPrice: 101, volume: 0.02, minVolume: 0.02 }),
      false,
      false,
    );
    expect(d.closeVolume).toBeNull();
    expect(d.reason).toContain("minimum volume");
  });

  it("[INVARIANT] treats missing broker facts as undecidable, never as an action", () => {
    expect(decideManagedPosition(facts({ openPrice: null }), false, false).undecidable).toBe(true);
    expect(
      decideManagedPosition(facts({ currentPrice: 101, volumeStep: null }), false, false)
        .undecidable,
    ).toBe(true);
    expect(decideManagedPosition(facts({ firstTarget: null }), false, false).undecidable).toBe(
      true,
    );
  });

  it("[INVARIANT] moves the stop to the fill price only after a confirmed partial", () => {
    const d = decideManagedPosition(facts(), true, false);
    expect(d.moveStopTo).toBe(100);
  });

  it("[INVARIANT] never moves a stop backwards", () => {
    const d = decideManagedPosition(facts({ currentStop: 100.4 }), true, false);
    expect(d.moveStopTo).toBeNull();
  });

  it("[INVARIANT] uses the short side's direction for the target test", () => {
    expect(
      decideManagedPosition(
        facts({ side: "short", firstTarget: 99, currentPrice: 99 }),
        false,
        false,
      ).closeVolume,
    ).toBe(0.5);
  });
});

describe("roundDownToStep", () => {
  it("[INVARIANT] never rounds up", () => {
    expect(roundDownToStep(0.199, 0.01)).toBe(0.19);
    expect(roundDownToStep(0.004, 0.01)).toBe(0);
  });
});

describe("decideManagedStep — laddered exits", () => {
  const plan = { laddered: true, shares: [1 / 3, 1 / 3, 1 / 3] as const, trailRunner: false };
  const progress = (over: Partial<ManagedProgress> = {}): ManagedProgress => ({
    partialDone: false,
    stopMoved: false,
    secondPartialDone: false,
    runnerStopMoved: false,
    ...over,
  });
  const laddered = (over: Partial<ManagedPositionFacts> = {}): ManagedPositionFacts =>
    facts({ secondTarget: 102, originalVolume: 0.9, ...over });

  it("[INVARIANT] takes the configured share of the ORIGINAL fill at the first target", () => {
    const d = decideManagedStep(
      laddered({ currentPrice: 101, volume: 0.9 }),
      progress(),
      plan,
    );
    expect(d.step).toBe("partial_1");
    expect(d.closeVolume).toBe(0.3);
  });

  it("[INVARIANT] protects the remainder at the fill price before looking deeper", () => {
    const d = decideManagedStep(
      laddered({ currentPrice: 102, volume: 0.6 }),
      progress({ partialDone: true }),
      plan,
    );
    expect(d.step).toBe("stop_to_entry");
    expect(d.moveStopTo).toBe(100);
  });

  it("[INVARIANT] waits for the second target before closing the second share", () => {
    const d = decideManagedStep(
      laddered({ currentPrice: 101.5, volume: 0.6, currentStop: 100 }),
      progress({ partialDone: true, stopMoved: true }),
      plan,
    );
    expect(d.step).toBeNull();
    expect(d.reason).toContain("second target");
    expect(d.undecidable).toBe(false);
  });

  it("[UNIT] closes the second share and then lifts the stop to the first target", () => {
    const at2 = laddered({ currentPrice: 102, volume: 0.6, currentStop: 100 });
    const close2 = decideManagedStep(at2, progress({ partialDone: true, stopMoved: true }), plan);
    expect(close2.step).toBe("partial_2");
    expect(close2.closeVolume).toBe(0.3);

    const lift = decideManagedStep(
      laddered({ currentPrice: 102, volume: 0.3, currentStop: 100 }),
      progress({ partialDone: true, stopMoved: true, secondPartialDone: true }),
      plan,
    );
    expect(lift.step).toBe("stop_to_first_target");
    expect(lift.moveStopTo).toBe(101);
  });

  it("[INVARIANT] treats a missing second target as undecidable, never as an action", () => {
    const d = decideManagedStep(
      laddered({ currentPrice: 102, volume: 0.6, secondTarget: null, currentStop: 100 }),
      progress({ partialDone: true, stopMoved: true }),
      plan,
    );
    expect(d.undecidable).toBe(true);
    expect(d.step).toBeNull();
  });

  it("[INVARIANT] trails only when it is switched on, and never backwards", () => {
    const settled = progress({
      partialDone: true,
      stopMoved: true,
      secondPartialDone: true,
      runnerStopMoved: true,
    });
    const off = decideManagedStep(
      laddered({ currentPrice: 103, volume: 0.3, currentStop: 101, bestPrice: 104, riskDistance: 1 }),
      settled,
      plan,
    );
    expect(off.step).toBeNull();

    const on = decideManagedStep(
      laddered({ currentPrice: 103, volume: 0.3, currentStop: 101, bestPrice: 104, riskDistance: 1 }),
      settled,
      { ...plan, trailRunner: true },
    );
    expect(on.step).toBe("trail");
    expect(on.moveStopTo).toBe(103 - 0);

    const backwards = decideManagedStep(
      laddered({ currentPrice: 103, volume: 0.3, currentStop: 103.5, bestPrice: 104, riskDistance: 1 }),
      settled,
      { ...plan, trailRunner: true },
    );
    expect(backwards.moveStopTo).toBeNull();
  });
});

describe("managedPlan", () => {
  it("[UNIT] reads the split preset and marks only the laddered policy as laddered", () => {
    expect(managedPlan("ladder_tp1_tp2_runner_tp3", "thirds").laddered).toBe(true);
    expect(managedPlan("partial_tp1_runner_tp2", "thirds").laddered).toBe(false);
    expect(managedPlan("ladder_tp1_tp2_runner_tp3", "quarter_half_quarter").shares[1]).toBe(0.5);
  });
});
