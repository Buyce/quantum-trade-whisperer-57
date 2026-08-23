/**
 * Stage-4 broker evidence association tests.
 *
 * These lock the ownership boundary: only deals P-Trades itself created become
 * evidence, a partially closed position is never reported as a finished trade,
 * and no price is ever inferred.
 */
import { describe, expect, it } from "vitest";

import {
  evidenceClassFor,
  groupOwnedDeals,
  summariseGroup,
  weightedPrice,
} from "../associate";
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
    const groups = groupOwnedDeals([deal({}), deal({ id: "d2", entryType: "DEAL_ENTRY_OUT" })], 140714);
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
