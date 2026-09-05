import { describe, expect, it } from "vitest";

import {
  aggregateBrokerTotals,
  aggregateBrokerTotalsByAttribution,
  aggregateJournalTotals,
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
  it("returns zeros for no rows rather than any placeholder", () => {
    const t = aggregateBrokerTotals([]);
    expect(t).toMatchObject({ wins: 0, losses: 0, breakeven: 0, closed: 0, accounts: 0 });
    expect(t.grossProfit).toBe(0);
  });

  it("classifies win, loss and breakeven by broker net money", () => {
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

  it("never counts an unreported trade as a loss", () => {
    const t = aggregateBrokerTotals([row({ grossProfit: null }), row({ grossProfit: 5 })]);
    expect(t).toMatchObject({ wins: 1, losses: 0, breakeven: 0, unmeasured: 1, closed: 2 });
  });

  it("counts distinct accounts and ignores missing account ids", () => {
    const t = aggregateBrokerTotals([
      row({ accountId: "a" }),
      row({ accountId: "a" }),
      row({ accountId: "b" }),
      row({ accountId: null }),
    ]);
    expect(t.accounts).toBe(2);
  });

  it("refuses to add unlike currencies", () => {
    const t = aggregateBrokerTotals([row({ currency: "USD" }), row({ currency: "EUR" })]);
    expect(t.mixedCurrency).toBe(true);
    expect(t.grossProfit).toBeNull();
    expect(t.netProfit).toBeNull();
    expect(t.currency).toBeNull();
    expect(t.wins).toBe(2);
  });
});

describe("aggregateJournalTotals", () => {
  it("counts each recorded outcome and keeps unknowns visible", () => {
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

  it("routes each row into exactly one bucket", () => {
    const t = aggregateBrokerTotalsByAttribution(rows);
    expect(t.auto).toMatchObject({ wins: 1, losses: 1, closed: 2 });
    expect(t.unlinked).toMatchObject({ wins: 1, losses: 0, closed: 1 });
    expect(t.external).toMatchObject({ wins: 0, losses: 1, closed: 1 });
  });

  it("keeps the combined total equal to the buckets", () => {
    const t = aggregateBrokerTotalsByAttribution(rows);
    expect(t.all.closed).toBe(t.auto.closed + t.unlinked.closed + t.external.closed);
    expect(t.all.wins).toBe(t.auto.wins + t.unlinked.wins + t.external.wins);
    expect(t.all.losses).toBe(t.auto.losses + t.unlinked.losses + t.external.losses);
    expect(t.all.grossProfit).toBe(11);
    expect(t.all).toEqual(aggregateBrokerTotals(rows));
  });

  it("renders empty buckets as zeros, never as a placeholder", () => {
    const t = aggregateBrokerTotalsByAttribution([row({ attribution: "auto" })]);
    expect(t.unlinked).toMatchObject({ closed: 0, wins: 0, losses: 0, accounts: 0 });
    expect(t.external.grossProfit).toBe(0);
  });
});
