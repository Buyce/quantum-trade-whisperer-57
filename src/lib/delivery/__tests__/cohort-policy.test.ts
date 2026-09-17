import { describe, expect, it } from "vitest";
import {
  clampCohortRiskShare,
  describeCohortPolicy,
  evaluateCohortPolicy,
  type CohortPolicyRow,
} from "../cohort-policy";

const rows: CohortPolicyRow[] = [
  { instrument: "GBPAUD", direction: "short", policy: "block", risk_share_percent: 100 },
  { instrument: "EURUSD", direction: "short", policy: "reduce", risk_share_percent: 25 },
  { instrument: "XAUUSD", direction: "long", policy: "allow", risk_share_percent: 100 },
];

describe("per-cohort automatic-order rule", () => {
  it("[UNIT] blocks only the exact instrument and direction the owner blocked", () => {
    expect(evaluateCohortPolicy(rows, { instrument: "GBPAUD", direction: "short" }).allowed).toBe(
      false,
    );
    expect(evaluateCohortPolicy(rows, { instrument: "GBPAUD", direction: "long" }).allowed).toBe(
      true,
    );
  });

  it("[UNIT] scales risk for a reduced cohort and never above normal", () => {
    const verdict = evaluateCohortPolicy(rows, { instrument: "EURUSD", direction: "short" });
    expect(verdict.allowed).toBe(true);
    expect(verdict.policy).toBe("reduce");
    expect(verdict.riskScale).toBe(0.25);
    expect(
      evaluateCohortPolicy(
        [{ instrument: "EURUSD", direction: "long", policy: "reduce", risk_share_percent: 250 }],
        { instrument: "EURUSD", direction: "long" },
      ).riskScale,
    ).toBe(1);
  });

  it("[UNIT] treats a missing, unknown or directionless case as allow", () => {
    expect(evaluateCohortPolicy(rows, { instrument: "USDJPY", direction: "short" }).allowed).toBe(
      true,
    );
    expect(evaluateCohortPolicy(null, { instrument: "GBPAUD", direction: "short" }).allowed).toBe(
      true,
    );
    expect(evaluateCohortPolicy(rows, { instrument: "GBPAUD", direction: null }).riskScale).toBe(1);
    expect(
      evaluateCohortPolicy(
        [{ instrument: "GBPAUD", direction: "short", policy: "nonsense", risk_share_percent: null }],
        { instrument: "GBPAUD", direction: "short" },
      ).allowed,
    ).toBe(true);
  });

  it("[UNIT] matches case-insensitively", () => {
    expect(evaluateCohortPolicy(rows, { instrument: "gbpaud", direction: "SHORT" }).allowed).toBe(
      false,
    );
  });

  it("[UNIT] clamps shares into the supported band", () => {
    expect(clampCohortRiskShare(0)).toBe(1);
    expect(clampCohortRiskShare(999)).toBe(100);
    expect(clampCohortRiskShare("abc")).toBe(50);
  });

  it("[UNIT] describes a saved rule for the owner", () => {
    expect(describeCohortPolicy(rows[0]!)).toContain("automatic orders off");
    expect(describeCohortPolicy(rows[1]!)).toContain("25% of normal risk");
  });
});
