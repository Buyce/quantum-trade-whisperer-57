import { describe, expect, it } from "vitest";

import { aggregateAutoTraderOutcomes } from "@/lib/admin/auto-trader-outcomes";

const trade = (over: Partial<Parameters<typeof aggregateAutoTraderOutcomes>[0][number]> = {}) => ({
  grade: "A" as string | null,
  gradeSource: "delivery" as string | null,
  netProfit: 10 as number | null,
  rVsPlan: 1 as number | null,
  currency: "EUR" as string | null,
  ...over,
});

describe("aggregateAutoTraderOutcomes", () => {
  it("reports nothing when there are no closed trades", () => {
    const out = aggregateAutoTraderOutcomes([]);
    expect(out.total.trades).toBe(0);
    expect(out.total.winRate).toBeNull();
    expect(out.total.netProfit).toBeNull();
    expect(out.byGrade).toEqual([]);
  });

  it("counts wins, losses and scratches from broker net money", () => {
    const out = aggregateAutoTraderOutcomes([
      trade({ netProfit: 20 }),
      trade({ netProfit: -5 }),
      trade({ netProfit: 0 }),
    ]);
    expect(out.total.wins).toBe(1);
    expect(out.total.losses).toBe(1);
    expect(out.total.scratches).toBe(1);
    expect(out.total.winRate).toBeCloseTo(1 / 3);
    expect(out.total.netProfit).toBe(15);
    expect(out.total.currency).toBe("EUR");
  });

  it("excludes unreported money from the win-rate denominator instead of calling it a loss", () => {
    const out = aggregateAutoTraderOutcomes([trade({ netProfit: 10 }), trade({ netProfit: null })]);
    expect(out.total.trades).toBe(2);
    expect(out.total.measured).toBe(1);
    expect(out.total.unmeasured).toBe(1);
    expect(out.total.winRate).toBe(1);
  });

  it("refuses to add unlike profit currencies", () => {
    const out = aggregateAutoTraderOutcomes([
      trade({ currency: "EUR" }),
      trade({ currency: "USD" }),
    ]);
    expect(out.total.mixedCurrency).toBe(true);
    expect(out.total.netProfit).toBeNull();
    expect(out.total.currency).toBeNull();
  });

  it("buckets by grade in grade order, keeping unknown grades visible", () => {
    const out = aggregateAutoTraderOutcomes([
      trade({ grade: "C", netProfit: -1 }),
      trade({ grade: "A+", netProfit: 3 }),
      trade({ grade: null, netProfit: 2, gradeSource: null, rVsPlan: null }),
    ]);
    expect(out.byGrade.map((b) => b.grade)).toEqual(["A+", "C", "Unknown"]);
    expect(out.byGrade[2]?.trades).toBe(1);
  });

  it("counts recovered grades and leaves them out of mean R when plan geometry is gone", () => {
    const out = aggregateAutoTraderOutcomes([
      trade({ gradeSource: "recovered_from_enqueue_decision", rVsPlan: null }),
      trade({ rVsPlan: 2 }),
    ]);
    expect(out.total.recoveredGrades).toBe(1);
    expect(out.total.rSample).toBe(1);
    expect(out.total.meanR).toBe(2);
  });
});
