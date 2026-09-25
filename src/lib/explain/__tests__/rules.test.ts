import { describe, expect, it } from "vitest";
import { checkRules } from "../rules";

describe("[UNIT] explain rule checks", () => {
  const settings = { instruments: ["EURUSD"], min_grade: "B", max_stop_loss_percent: 1, risk_per_trade_percent: 1 };
  it("[UNIT] detects wrong-side stop, blocked cohort, grade and instrument conflicts", () => {
    const r = checkRules(
      { instrument: "GBPAUD", direction: "long", grade: "C", entry: 1, stop: 1.1, target: 1.2 },
      settings,
      { policy: "block", risk_share_percent: 100 },
    );
    expect(r.filter((c) => c.status === "conflict").length).toBeGreaterThanOrEqual(4);
  });
  it("[UNIT] reports unknown when geometry is missing", () => {
    const r = checkRules({ instrument: null, direction: null, grade: null, entry: null, stop: null, target: null }, null, null);
    expect(r.every((c) => c.status === "unknown")).toBe(true);
  });
});
