import { describe, expect, it } from "vitest";

import {
  MAX_MISSINGNESS_PCT,
  evaluateAdvancement,
  type AdvancementEvidence,
  type OutcomeEvidence,
} from "../advancement";
import type { PromotionVerdict } from "../promotion";

const NOW = new Date("2026-09-10T05:10:00.000Z");

const strong = (mean = 0.4): OutcomeEvidence => ({
  samples: 120,
  clusters: 14,
  expectedR: mean,
  ciLow: mean - 0.1,
  ciHigh: mean + 0.3,
});

const promotable = (ok: boolean): PromotionVerdict =>
  ({
    instrument: "USDJPY",
    promotable: ok,
    blockers: [],
    reasons: ok ? [] : ["Only 3 trading days of samples (needs 5)."],
    evidence: { missingnessPct: 4 },
  }) as unknown as PromotionVerdict;

const base = (over: Partial<AdvancementEvidence> = {}): AdvancementEvidence => ({
  instrument: "USDJPY",
  stage: "data_validation",
  promotion: promotable(true),
  shadow: strong(),
  published: strong(),
  holdout: { splitDay: "2026-09-05", samples: 60, clusters: 6, meanR: 0.35, ciLow: 0.1 },
  readinessFailures: 0,
  missingnessPct: 5,
  lastAutoTransitionDay: null,
  ...over,
});

describe("automatic stage advancement", () => {
  it("[INVARIANT] promotes one rung at a time and never skips", () => {
    expect(evaluateAdvancement(base(), NOW)).toMatchObject({ action: "promote", target: "shadow" });
    expect(evaluateAdvancement(base({ stage: "shadow" }), NOW)).toMatchObject({
      action: "promote",
      target: "signals_only",
    });
    expect(evaluateAdvancement(base({ stage: "signals_only" }), NOW)).toMatchObject({
      action: "promote",
      target: "execution_approved",
    });
    expect(evaluateAdvancement(base({ stage: "execution_approved" }), NOW).action).toBe("hold");
  });

  it("[INVARIANT] holds when the stage cannot be read", () => {
    const verdict = evaluateAdvancement(base({ stage: null }), NOW);
    expect(verdict.action).toBe("hold");
    expect(verdict.reasons[0]).toContain("could not be read");
  });

  it("[INVARIANT] never moves suspended or disabled instruments", () => {
    for (const stage of ["suspended", "disabled"] as const) {
      expect(evaluateAdvancement(base({ stage }), NOW).action).toBe("hold");
    }
  });

  it("[INVARIANT] allows at most one automatic step per UTC day", () => {
    const verdict = evaluateAdvancement(base({ lastAutoTransitionDay: "2026-09-10" }), NOW);
    expect(verdict.action).toBe("hold");
    expect(verdict.reasons[0]).toContain("one step per day");
  });

  it("[INVARIANT] an unmeasured input blocks instead of passing", () => {
    for (const over of [
      { shadow: null },
      { missingnessPct: null },
      { readinessFailures: null },
    ] as Partial<AdvancementEvidence>[]) {
      expect(evaluateAdvancement(base({ stage: "shadow", ...over }), NOW).action).toBe("hold");
    }
  });

  it("[INVARIANT] refuses when the interval reaches zero, even with positive mean", () => {
    const verdict = evaluateAdvancement(
      base({
        stage: "shadow",
        shadow: { samples: 120, clusters: 14, expectedR: 0.2, ciLow: -0.05, ciHigh: 0.5 },
      }),
      NOW,
    );
    expect(verdict.action).toBe("hold");
    expect(verdict.reasons.join(" ")).toContain("not distinguishable from zero");
  });

  it("[INVARIANT] requires a chronological holdout before execution is permitted", () => {
    expect(evaluateAdvancement(base({ stage: "signals_only", holdout: null }), NOW).action).toBe(
      "hold",
    );
    expect(
      evaluateAdvancement(
        base({
          stage: "signals_only",
          holdout: { splitDay: "2026-09-05", samples: 60, clusters: 6, meanR: 0.1, ciLow: -0.2 },
        }),
        NOW,
      ).action,
    ).toBe("hold");
  });

  it("[UNIT] carries the checkpoint's own blockers on the first rung", () => {
    const verdict = evaluateAdvancement(base({ promotion: promotable(false) }), NOW);
    expect(verdict.action).toBe("hold");
    expect(verdict.reasons[0]).toContain("trading days");
  });

  it("[INVARIANT] never moves an instrument DOWN a stage on degraded data quality", () => {
    const verdict = evaluateAdvancement(
      base({ stage: "execution_approved", missingnessPct: MAX_MISSINGNESS_PCT + 15 }),
      NOW,
    );
    expect(verdict).toMatchObject({ action: "hold", target: null });
    expect(verdict.reasons.join(" ")).toContain("missingness");
  });

  it("[INVARIANT] holds, never demotes, on repeated readiness failures", () => {
    const verdict = evaluateAdvancement(
      base({ stage: "shadow", readinessFailures: 4, lastAutoTransitionDay: "2026-09-10" }),
      NOW,
    );
    expect(verdict).toMatchObject({ action: "hold", target: null });
  });

  it("[INVARIANT] negative expectancy holds the instrument rather than stepping it back", () => {
    const negative = { samples: 120, clusters: 14, expectedR: -0.4, ciLow: -0.7, ciHigh: -0.1 };
    expect(evaluateAdvancement(base({ stage: "shadow", shadow: negative }), NOW)).toMatchObject({
      action: "hold",
      target: null,
    });
  });

  it("[INVARIANT] no verdict this module can produce is a demotion", () => {
    const cases = [
      base({ stage: "execution_approved", missingnessPct: 90 }),
      base({ stage: "signals_only", readinessFailures: 9 }),
      base({ stage: "shadow", shadow: null }),
    ];
    for (const e of cases) expect(evaluateAdvancement(e, NOW).action).not.toBe("demote");
  });
});
