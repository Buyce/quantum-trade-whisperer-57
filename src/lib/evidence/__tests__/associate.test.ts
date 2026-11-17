/**
 * Stage-4 broker evidence association tests.
 *
 * These lock the ownership boundary: only deals P-Trades itself created become
 * evidence, a partially closed position is never reported as a finished trade,
 * and no price is ever inferred.
 */
import { describe, expect, it } from "vitest";

import { evidenceClassFor, groupOwnedDeals, summariseGroup, weightedPrice } from "../associate";
import { buildClientId, PTRADES_STRATEGY_ID } from "@/lib/metaapi/client-id";
import type { BrokerDeal } from "@/lib/metaapi/types";

const clientId = buildClientId({
  strategyId: PTRADES_STRATEGY_ID,
  positionRef: "3f4a1c9e2b6d4f7a9c118d5e6f7a8b9c",
  orderRef: "4821",
});

const deal = (over: Partial<BrokerDeal>): BrokerDeal => ({
  id: "d1",
  orderId: "o1",
  positionId: "p1",
  symbol: "EURUSD",
  entryType: "DEAL_ENTRY_IN",
  volume: 0.25,
  price: 1.085,
  magic: 140714,
  clientId,
  brokerTime: "2026-08-24T09:30:00.000Z",
  ...over,
});

describe("positive association", () => {
  it("[INVARIANT] ignores deals that P-Trades did not create", () => {
    const groups = groupOwnedDeals(
      [deal({ clientId: "manual-trade" }), deal({ clientId: null })],
      140714,
    );
    expect(groups).toHaveLength(0);
  });

  it("[UNIT] groups our own deals by clientId and records the basis", () => {
    const groups = groupOwnedDeals(
      [deal({}), deal({ id: "d2", entryType: "DEAL_ENTRY_OUT" })],
      140714,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.basis).toBe("client_id_and_magic");
    expect(groups[0]!.orderRef).toBe("4821");
    expect(groups[0]!.deals).toHaveLength(2);
  });

  it("[INVARIANT] excludes a deal whose magic contradicts the account's magic", () => {
    expect(groupOwnedDeals([deal({ magic: 999 })], 140714)).toHaveLength(0);
  });

  it("[UNIT] still associates by clientId alone when the broker reports no magic", () => {
    const groups = groupOwnedDeals([deal({ magic: null })], 140714);
    expect(groups[0]!.basis).toBe("client_id");
  });
});

describe("deal summarisation", () => {
  it("[INVARIANT] reports an entry-only position as open with no exit price", () => {
    const [group] = groupOwnedDeals([deal({})], 140714);
    const summary = summariseGroup(group!);
    expect(summary.state).toBe("open");
    expect(summary.entryPrice).toBe(1.085);
    expect(summary.exitPrice).toBeNull();
    expect(summary.grossProfit).toBeNull();
  });

  it("[INVARIANT] closes only when the closing volume matches the opening volume", () => {
    const partial = groupOwnedDeals(
      [deal({}), deal({ id: "d2", entryType: "DEAL_ENTRY_OUT", volume: 0.1, price: 1.09 })],
      140714,
    );
    expect(summariseGroup(partial[0]!).state).toBe("open");

    const full = groupOwnedDeals(
      [
        deal({}),
        deal({
          id: "d2",
          entryType: "DEAL_ENTRY_OUT",
          volume: 0.25,
          price: 1.095,
          profit: 25,
          brokerTime: "2026-08-24T11:00:00.000Z",
        }),
      ],
      140714,
    );
    const summary = summariseGroup(full[0]!);
    expect(summary.state).toBe("closed");
    expect(summary.exitPrice).toBe(1.095);
    expect(summary.grossProfit).toBe(25);
    expect(summary.exitAt).toBe("2026-08-24T11:00:00.000Z");
  });

  it("[UNIT] returns null rather than a guess when a leg has no usable price", () => {
    expect(weightedPrice([deal({ price: null })]).price).toBeNull();
    expect(weightedPrice([deal({ volume: 0 })]).volume).toBeNull();
  });

  it("[UNIT] volume-weights multiple entry fills", () => {
    const { price, volume } = weightedPrice([
      deal({ volume: 1, price: 1.1 }),
      deal({ volume: 1, price: 1.2 }),
    ]);
    expect(volume).toBe(2);
    expect(price).toBeCloseTo(1.15, 10);
  });
});

describe("evidence classes stay separate", () => {
  it("[UNIT] labels the benchmark account and customer accounts distinctly", () => {
    expect(evidenceClassFor(true)).toBe("benchmark");
    expect(evidenceClassFor(false)).toBe("customer");
  });
});

describe("closing leg linked by broker position id", () => {
  const open = deal({ volume: 0.09 });
  const close = (over: Partial<BrokerDeal> = {}) =>
    deal({ id: "d2", entryType: "DEAL_ENTRY_OUT", clientId: null, magic: 0, volume: 0.09, price: 1.08, profit: 4.23, ...over });

  it("[UNIT] an untagged close on our position closes the trade", () => {
    const groups = groupOwnedDeals([open, close()], 140714);
    expect(groups[0]!.deals).toHaveLength(2);
    expect(groups[0]!.basis).toBe("position_id");
    expect(summariseGroup(groups[0]!).state).toBe("closed");
  });

  it("[UNIT] an untagged close-by also joins", () => {
    const groups = groupOwnedDeals([open, close({ entryType: "DEAL_ENTRY_OUT_BY" })], 140714);
    expect(groups[0]!.deals).toHaveLength(2);
  });

  it("[INVARIANT] a close on a different position is not absorbed", () => {
    const groups = groupOwnedDeals([open, close({ positionId: "p9" })], 140714);
    expect(groups[0]!.deals).toHaveLength(1);
  });

  it("[INVARIANT] a position with a foreign opening leg is refused", () => {
    const foreign = deal({ id: "d3", clientId: "manual", volume: 0.1 });
    const groups = groupOwnedDeals([open, foreign, close()], 140714);
    expect(groups[0]!.deals).toHaveLength(1);
  });

  it("[INVARIANT] a partial untagged close keeps the trade open", () => {
    const groups = groupOwnedDeals([open, close({ volume: 0.04 })], 140714);
    expect(summariseGroup(groups[0]!).state).toBe("open");
  });
});

describe("closure matcher gaps (Codex 2026-11-17)", () => {
  const open = deal({ volume: 0.09, symbol: "XAUUSD" });
  const close = (over: Partial<BrokerDeal> = {}) =>
    deal({ id: "d2", entryType: "DEAL_ENTRY_OUT", clientId: null, magic: 0, volume: 0.09, symbol: "XAUUSD", price: 3860.77, ...over });
  const otherId = buildClientId({ strategyId: PTRADES_STRATEGY_ID, positionRef: "aaaabbbbccccddddeeeeffff00001111", orderRef: "9999" });

  it("[GAP1] an exit keeping our clientId but magic 0 joins the proven position", () => {
    const g = groupOwnedDeals([open, close({ clientId })], 140714);
    expect(g).toHaveLength(1);
    expect(summariseGroup(g[0]!).state).toBe("closed");
  });

  it("[GAP2] an untagged INOUT reversal makes the position mixed and refuses later OUT", () => {
    const rev = deal({ id: "d3", entryType: "DEAL_ENTRY_INOUT", clientId: null, magic: 0, volume: 0.18, symbol: "XAUUSD" });
    const g = groupOwnedDeals([open, rev, close({ id: "d4" })], 140714);
    expect(g[0]!.deals).toHaveLength(1);
  });

  it("[GAP3] a close with no symbol is refused", () => {
    const g = groupOwnedDeals([open, close({ symbol: undefined as unknown as string })], 140714);
    expect(g[0]!.deals).toHaveLength(1);
  });

  it("[GAP4] a reused clientId opening with conflicting magic still marks the position mixed", () => {
    const foreign = deal({ id: "d3", magic: 555, volume: 0.05, symbol: "XAUUSD" });
    const g = groupOwnedDeals([open, foreign, close()], 140714);
    expect(g[0]!.deals).toHaveLength(1);
  });

  it("[INVARIANT] two P-Trades owners on one position refuse the untagged close", () => {
    const second = deal({ id: "d5", clientId: otherId, volume: 0.09, symbol: "XAUUSD" });
    const g = groupOwnedDeals([open, second, close()], 140714);
    for (const x of g) expect(x.deals).toHaveLength(1);
  });

  it("[INVARIANT] a close tagged with a different P-Trades reference is refused", () => {
    const g = groupOwnedDeals([open, close({ clientId: otherId, magic: 0 })], 140714);
    expect(g.find((x) => x.clientId === clientId)!.deals).toHaveLength(1);
  });

  it("[UNIT] unordered history and multiple partial closes settle once volumes match", () => {
    const g = groupOwnedDeals([close({ id: "a", volume: 0.04 }), open, close({ id: "b", volume: 0.05 })], 140714);
    expect(summariseGroup(g[0]!).state).toBe("closed");
  });

  it("[INVARIANT] a duplicated deal id is counted once", () => {
    const g = groupOwnedDeals([open, close({ volume: 0.09 }), close({ volume: 0.09 })], 140714);
    expect(g[0]!.deals).toHaveLength(2);
  });

  it("[INVARIANT] an exit with no opening evidence creates nothing", () => {
    expect(groupOwnedDeals([close()], 140714)).toHaveLength(0);
  });
});

describe("ticket 49064728 broker record (read-only fetch 2026-11-17)", () => {
  // Field values copied from MetaApi readDealsByPosition for position 49064728.
  const cid = "PT_397fc1e8020213aba_79618";
  const inDeal: BrokerDeal = { id: "46056143", orderId: "49064728", positionId: "49064728", entryType: "DEAL_ENTRY_IN", symbol: "XAUUSD", clientId: cid, magic: 925279293, volume: 0.09, price: 3861.24, time: "2026-11-17T10:36:07.332Z", brokerTime: "2026-11-17 11:36:07.332", profit: 0, commission: -0.27, swap: 0 } as BrokerDeal;
  const outDeal: BrokerDeal = { id: "46076360", orderId: "49086488", positionId: "49064728", entryType: "DEAL_ENTRY_OUT", symbol: "XAUUSD", clientId: cid, magic: 0, volume: 0.09, price: 3860.77, time: "2026-11-17T11:51:49.645Z", brokerTime: "2026-11-17 12:51:49.645", profit: 4.23, commission: -0.27, swap: 0 } as BrokerDeal;

  it("[REGRESSION] a mobile close keeping our clientId with magic 0 settles the trade", () => {
    const g = groupOwnedDeals([inDeal, outDeal], 925279293);
    const s = summariseGroup(g[0]!);
    expect(s.state).toBe("closed");
    expect(s.exitPrice).toBe(3860.77);
    expect(s.grossProfit).toBeCloseTo(4.23, 9);
    expect(s.commission).toBeCloseTo(-0.54, 9);
  });

  it("[REGRESSION] times use canonical UTC, not broker-local clock", () => {
    const s = summariseGroup(groupOwnedDeals([inDeal, outDeal], 925279293)[0]!);
    expect(s.entryAt).toBe("2026-11-17T10:36:07.332Z");
    expect(s.exitAt).toBe("2026-11-17T11:51:49.645Z");
  });
});
