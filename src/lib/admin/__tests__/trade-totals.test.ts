import { describe, expect, it } from "vitest";

import {
  aggregateBrokerTotals,
  aggregateBrokerTotalsByAttribution,
  aggregateJournalTotals,
  aggregateJournalPerformance,
  type BrokerEvidenceRow,
} from "@/lib/admin/trade-totals";

const row = (over: Partial<BrokerEvidenceRow> = {}): BrokerEvidenceRow => ({
  accountId: "acc-1",
  grossProfit: 10,
  swap: 0,
  commission: 0,
  currency: "USD",
  attribution: "auto",
  ...over,
});

describe("aggregateBrokerTotals", () => {
  it("[UNIT] returns zeros for no rows rather than any placeholder", () => {
    const t = aggregateBrokerTotals([]);
    expect(t).toMatchObject({ wins: 0, losses: 0, breakeven: 0, closed: 0, accounts: 0 });
    expect(t.grossProfit).toBe(0);
  });

  it("[UNIT] classifies win, loss and breakeven by broker net money", () => {
    const t = aggregateBrokerTotals([
      row({ grossProfit: 10 }),
      row({ grossProfit: -5 }),
      row({ grossProfit: 0 }),
      // Fees can push a gross win into a net loss.
      row({ grossProfit: 2, commission: -4 }),
    ]);
    expect(t).toMatchObject({ wins: 1, losses: 2, breakeven: 1, closed: 4, unmeasured: 0 });
    expect(t.grossProfit).toBe(7);
    expect(t.netProfit).toBe(3);
  });

  it("[UNIT] never counts an unreported trade as a loss", () => {
    const t = aggregateBrokerTotals([row({ grossProfit: null }), row({ grossProfit: 5 })]);
    expect(t).toMatchObject({ wins: 1, losses: 0, breakeven: 0, unmeasured: 1, closed: 2 });
  });

  it("[UNIT] counts distinct accounts and ignores missing account ids", () => {
    const t = aggregateBrokerTotals([
      row({ accountId: "a" }),
      row({ accountId: "a" }),
      row({ accountId: "b" }),
      row({ accountId: null }),
    ]);
    expect(t.accounts).toBe(2);
  });

  it("[UNIT] refuses to add unlike currencies", () => {
    const t = aggregateBrokerTotals([row({ currency: "USD" }), row({ currency: "EUR" })]);
    expect(t.mixedCurrency).toBe(true);
    expect(t.grossProfit).toBeNull();
    expect(t.netProfit).toBeNull();
    expect(t.currency).toBeNull();
    expect(t.wins).toBe(2);
  });
});

describe("aggregateJournalTotals", () => {
  it("[UNIT] counts each recorded outcome and keeps unknowns visible", () => {
    const t = aggregateJournalTotals(["win", "win", "loss", "open", "breakeven", null, "weird"]);
    expect(t).toEqual({ wins: 2, losses: 1, breakeven: 1, open: 1, other: 2, rows: 7 });
  });
});

describe("aggregateBrokerTotalsByAttribution", () => {
  const rows: BrokerEvidenceRow[] = [
    row({ attribution: "auto", grossProfit: 10 }),
    row({ attribution: "auto", grossProfit: -4 }),
    row({ attribution: "unlinked", grossProfit: 6, accountId: "acc-2" }),
    row({ attribution: "external", grossProfit: -1, accountId: "acc-3" }),
  ];

  it("[UNIT] routes each row into exactly one bucket", () => {
    const t = aggregateBrokerTotalsByAttribution(rows);
    expect(t.auto).toMatchObject({ wins: 1, losses: 1, closed: 2 });
    expect(t.unlinked).toMatchObject({ wins: 1, losses: 0, closed: 1 });
    expect(t.external).toMatchObject({ wins: 0, losses: 1, closed: 1 });
  });

  it("[UNIT] keeps the combined total equal to the buckets", () => {
    const t = aggregateBrokerTotalsByAttribution(rows);
    expect(t.all.closed).toBe(t.auto.closed + t.unlinked.closed + t.external.closed);
    expect(t.all.wins).toBe(t.auto.wins + t.unlinked.wins + t.external.wins);
    expect(t.all.losses).toBe(t.auto.losses + t.unlinked.losses + t.external.losses);
    expect(t.all.grossProfit).toBe(11);
    expect(t.all).toEqual(aggregateBrokerTotals(rows));
  });

  it("[UNIT] renders empty buckets as zeros, never as a placeholder", () => {
    const t = aggregateBrokerTotalsByAttribution([row({ attribution: "auto" })]);
    expect(t.unlinked).toMatchObject({ closed: 0, wins: 0, losses: 0, accounts: 0 });
    expect(t.external.grossProfit).toBe(0);
  });
});

describe("aggregateJournalPerformance", () => {
  const j = (outcome: string | null, r: number | null, createdAt: string | null) => ({
    outcome,
    r,
    createdAt,
  });

  it("[UNIT] reports the self-reported win rate over resolved rows only", () => {
    const p = aggregateJournalPerformance([
      j("win", 2, "2026-01-02T00:00:00Z"),
      j("loss", -1, "2026-01-03T00:00:00Z"),
      j("open", null, "2026-01-04T00:00:00Z"),
      j(null, null, "2026-01-05T00:00:00Z"),
    ]);
    expect(p.resolved).toBe(2);
    expect(p.winRatePercent).toBe(50);
    expect(p.totalR).toBe(1);
    expect(p.meanR).toBe(0.5);
  });

  it("[INVARIANT] excludes a resolved row with no R value instead of counting it as flat", () => {
    const p = aggregateJournalPerformance([
      j("win", 3, "2026-01-02T00:00:00Z"),
      j("loss", null, "2026-01-03T00:00:00Z"),
    ]);
    expect(p.rSamples).toBe(1);
    expect(p.missingR).toBe(1);
    expect(p.totalR).toBe(3);
    expect(p.meanR).toBe(3);
  });

  it("[UNIT] spans the first and last entry and refuses a total when no R exists", () => {
    const p = aggregateJournalPerformance([
      j("win", null, "2026-03-09T10:00:00Z"),
      j("loss", null, "2026-01-01T10:00:00Z"),
      j("open", null, null),
    ]);
    expect(p.firstLoggedAt).toBe("2026-01-01T10:00:00Z");
    expect(p.lastLoggedAt).toBe("2026-03-09T10:00:00Z");
    expect(p.totalR).toBeNull();
    expect(p.meanR).toBeNull();
  });

  it("[UNIT] claims no rate and no total for an empty journal", () => {
    const p = aggregateJournalPerformance([]);
    expect(p).toEqual({
      resolved: 0,
      winRatePercent: null,
      totalR: null,
      meanR: null,
      rSamples: 0,
      missingR: 0,
      firstLoggedAt: null,
      lastLoggedAt: null,
    });
  });
});
