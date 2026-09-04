import { describe, expect, it } from "vitest";
import {
  DECIDABLE_MIN_SAMPLES_PER_ARM,
  EMPTY_GATE_READINESS,
  isTrainingReady,
  missingFloors,
  readyGates,
  READINESS_MIN_SAMPLES_PER_ARM,
  type GateReadiness,
  type GateReadinessRow,
} from "../readiness";

const row = (over: Partial<GateReadinessRow> = {}): GateReadinessRow => ({
  gate: "risk_ceiling",
  manifest_hash: "abc",
  current_value: 3,
  override_active: false,
  pass_n_used: 400,
  fail_n_used: 300,
  pass_cluster_n: 25,
  fail_cluster_n: 21,
  pass_mean_r: 0.1,
  fail_mean_r: 0.4,
  pass_status: "descriptive",
  fail_status: "descriptive",
  decidable: true,
  verdict: "loosening_supported",
  training_ready: true,
  ...over,
});

const readiness = (rows: GateReadinessRow[], days = 25): GateReadiness => ({
  ...EMPTY_GATE_READINESS,
  as_of: "2026-09-04T07:00:00Z",
  trading_days: days,
  gates: rows,
  ready: rows.some((r) => r.training_ready),
});

describe("gate readiness", () => {
  it("[UNIT] reports no missing floors when every bar is cleared", () => {
    const r = readiness([row()]);
    expect(missingFloors(r.gates[0]!, r)).toEqual([]);
    expect(isTrainingReady(r)).toBe(true);
    expect(readyGates(r)).toHaveLength(1);
  });

  it("[UNIT] names the thin arm rather than rounding up to ready", () => {
    const r = readiness([row({ fail_n_used: 41, training_ready: false })]);
    const missing = missingFloors(r.gates[0]!, r);
    expect(missing.join(" ")).toContain(`rejected arm needs ${READINESS_MIN_SAMPLES_PER_ARM}`);
    expect(missing.join(" ")).toContain("has 41");
    expect(isTrainingReady(r)).toBe(false);
  });

  it("[UNIT] names missing clusters even when raw sample counts are large", () => {
    const r = readiness([row({ pass_cluster_n: 2, training_ready: false })]);
    expect(missingFloors(r.gates[0]!, r).join(" ")).toContain("independent clusters (has 2)");
  });

  it("[UNIT] names too few trading days", () => {
    const r = readiness([row({ training_ready: false })], 6);
    expect(missingFloors(r.gates[0]!, r).join(" ")).toContain("20 trading days");
  });

  it("[UNIT] explains an undecidable gate through the descriptive floor", () => {
    const r = readiness([
      row({ decidable: false, verdict: null, training_ready: false, pass_n_used: 4, fail_n_used: 3 }),
    ]);
    expect(missingFloors(r.gates[0]!, r).join(" ")).toContain(
      `${DECIDABLE_MIN_SAMPLES_PER_ARM}-sample descriptive floor`,
    );
  });

  it("[UNIT] explains overlapping intervals when the arms are otherwise big enough", () => {
    const r = readiness([row({ verdict: null, training_ready: false })]);
    expect(missingFloors(r.gates[0]!, r)).toEqual([
      "the two 95% intervals still overlap, so no direction is supported",
    ]);
  });

  it("[UNIT] treats an empty readiness payload as not ready", () => {
    expect(isTrainingReady(EMPTY_GATE_READINESS)).toBe(false);
    expect(readyGates(EMPTY_GATE_READINESS)).toEqual([]);
  });
});
