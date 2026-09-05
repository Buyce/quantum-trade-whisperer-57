import { describe, expect, it } from "vitest";
import type { CandidateLineageRow } from "@/lib/learning/candidates";
import { brokerCell, fixed2, replayOutcome } from "../lineage-cells";

const base: CandidateLineageRow = {
  candidate_id: "c1",
  instrument: "EURUSD",
  direction: "long",
  grade: "B",
  cf_grade: null,
  detected_at: "2026-09-04T00:00:00Z",
  enrolled_at: null,
  published_signal_id: null,
  v1_decision: null,
  shadow_status: null,
  shadow_outcome: null,
  shadow_realized_r: null,
  shadow_resolved_at: null,
  research_window_status: null,
  enqueue_decision: null,
  enqueue_reason: null,
  broker_state: null,
  broker_r_vs_plan: null,
  broker_net_profit: null,
  broker_currency: null,
};

describe("fixed2", () => {
  it("[UNIT] formats finite numbers and drops everything else", () => {
    expect(fixed2(1.234)).toBe("1.23");
    expect(fixed2(0)).toBe("0.00");
    expect(fixed2(null)).toBeNull();
    expect(fixed2(undefined)).toBeNull();
    expect(fixed2(Number.NaN)).toBeNull();
    expect(fixed2("1.5")).toBeNull();
  });
});

describe("replayOutcome", () => {
  it("[UNIT] survives an undefined realized R", () => {
    const row = {
      ...base,
      shadow_status: "resolved",
      shadow_outcome: "win",
      shadow_realized_r: undefined,
    } as unknown as CandidateLineageRow;
    expect(replayOutcome(row)).toBe("win");
  });

  it("[UNIT] labels replay R when present", () => {
    expect(
      replayOutcome({
        ...base,
        shadow_status: "resolved",
        shadow_outcome: "win",
        shadow_realized_r: 1.5,
      }),
    ).toBe("win · 1.50R (replay)");
  });
});

describe("brokerCell", () => {
  it("[UNIT] survives undefined broker money and R", () => {
    const row = {
      ...base,
      published_signal_id: "s1",
      enqueue_decision: "enqueued",
      broker_state: "closed",
      broker_net_profit: undefined,
      broker_r_vs_plan: undefined,
    } as unknown as CandidateLineageRow;
    expect(brokerCell(row)).toBe("broker closed");
  });

  it("[UNIT] shows money and R vs plan when both are real", () => {
    expect(
      brokerCell({
        ...base,
        published_signal_id: "s1",
        enqueue_decision: "enqueued",
        broker_state: "closed",
        broker_net_profit: -12.5,
        broker_currency: "EUR",
        broker_r_vs_plan: -1,
      }),
    ).toBe("broker closed · -12.50 EUR · -1.00R vs plan");
  });

  it("[UNIT] says never sent for a rejected candidate", () => {
    expect(brokerCell(base)).toBe("never sent — no broker order");
  });
});
