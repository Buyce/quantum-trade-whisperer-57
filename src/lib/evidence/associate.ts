/**
 * Prompt 14 Stage 4 — PURE broker-evidence association.
 *
 * A broker deal only becomes P-Trades evidence when the association is POSITIVE:
 * the deal carries a clientId this system built (and, where reported, our own
 * magic number). Manual trades the trader placed themselves, other EAs and
 * other strategies are never absorbed into P-Trades' record, and a deal is
 * never attributed to a setup by "closest price" or "nearest time".
 *
 * Pure: no fetch, no clock, no env, no Supabase.
 */
import { parseClientId } from "@/lib/metaapi/client-id";
import type { BrokerDeal } from "@/lib/metaapi/types";

/** How the association was proven. Recorded on every evidence row. */
export type AssociationBasis =
  "client_id" | "client_id_and_magic" | "position_id" | "self_reported";

/**
 * Where the evidence came from:
 *  - `benchmark`  — positively associated P-Trades benchmark demo evidence
 *  - `customer`   — a trader's connected broker account
 *  - `self_reported` — the trader typed it into the journal
 * These are separate populations and must never be pooled.
 */
export type EvidenceClass = "benchmark" | "customer" | "self_reported";

export interface DealGroup {
  clientId: string;
  /** Our own reference from the clientId's position slot (signal id tail). */
  positionRef: string;
  /** Our own reference from the clientId's order slot (delivery id). */
  orderRef: string;
  brokerPositionId: string | null;
  brokerOrderId: string | null;
  symbol: string | null;
  magic: number | null;
  basis: AssociationBasis;
  deals: BrokerDeal[];
}

function isEntry(deal: BrokerDeal): boolean {
  return (deal.entryType ?? "").toUpperCase() === "DEAL_ENTRY_IN";
}

function isExit(deal: BrokerDeal): boolean {
  const t = (deal.entryType ?? "").toUpperCase();
  return t === "DEAL_ENTRY_OUT" || t === "DEAL_ENTRY_OUT_BY";
}

/**
 * Group the deals P-Trades owns, keyed by clientId. `expectedMagic` is checked
 * when the broker reports a magic on the deal; a MISMATCH excludes the deal
 * rather than being ignored.
 */
export function groupOwnedDeals(
  deals: readonly BrokerDeal[],
  expectedMagic: number | null,
): DealGroup[] {
  const groups = new Map<string, DealGroup>();

  for (const deal of deals) {
    const refs = parseClientId(deal.clientId ?? null);
    if (!refs) continue; // not ours — never absorbed
    const magic = typeof deal.magic === "number" ? deal.magic : null;
    if (expectedMagic !== null && magic !== null && magic !== expectedMagic) continue;

    const key = deal.clientId as string;
    const existing = groups.get(key);
    if (existing) {
      existing.deals.push(deal);
      existing.brokerPositionId = existing.brokerPositionId ?? deal.positionId ?? null;
      existing.brokerOrderId = existing.brokerOrderId ?? deal.orderId ?? null;
      continue;
    }
    groups.set(key, {
      clientId: key,
      positionRef: refs.positionRef,
      orderRef: refs.orderRef,
      brokerPositionId: deal.positionId ?? null,
      brokerOrderId: deal.orderId ?? null,
      symbol: deal.symbol ?? null,
      magic,
      basis: magic !== null ? "client_id_and_magic" : "client_id",
      deals: [deal],
    });
  }

  return [...groups.values()];
}

export interface DealSummary {
  volume: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  entryAt: string | null;
  exitAt: string | null;
  commission: number | null;
  swap: number | null;
  grossProfit: number | null;
  /** `closed` only when the broker actually reported closing deals. */
  state: "open" | "closed";
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Volume-weighted average price, or null when any leg is unusable. */
export function weightedPrice(legs: readonly BrokerDeal[]): {
  price: number | null;
  volume: number | null;
} {
  let volume = 0;
  let notional = 0;
  for (const leg of legs) {
    const v = num(leg.volume);
    const p = num(leg.price);
    if (v === null || p === null || v <= 0 || p <= 0) return { price: null, volume: null };
    volume += v;
    notional += v * p;
  }
  if (volume <= 0) return { price: null, volume: null };
  return { price: notional / volume, volume };
}

function earliest(times: (string | null | undefined)[]): string | null {
  const parsed = times
    .map((t) => (t ? Date.parse(t) : Number.NaN))
    .filter((n) => Number.isFinite(n)) as number[];
  if (!parsed.length) return null;
  return new Date(Math.min(...parsed)).toISOString();
}

function latest(times: (string | null | undefined)[]): string | null {
  const parsed = times
    .map((t) => (t ? Date.parse(t) : Number.NaN))
    .filter((n) => Number.isFinite(n)) as number[];
  if (!parsed.length) return null;
  return new Date(Math.max(...parsed)).toISOString();
}

/**
 * Reduce a group of broker deals to the trade facts.
 *
 * Every field is broker-reported or null. A partially closed position stays
 * `open` and carries no exit price — a half-finished trade is never presented
 * as a completed result.
 */
export function summariseGroup(group: DealGroup): DealSummary {
  const entries = group.deals.filter(isEntry);
  const exits = group.deals.filter(isExit);

  const entry = weightedPrice(entries);
  const exit = weightedPrice(exits);

  const closed =
    exits.length > 0 &&
    entry.volume !== null &&
    exit.volume !== null &&
    Math.abs(exit.volume - entry.volume) < 1e-9;

  const sum = (pick: (d: BrokerDeal) => unknown): number | null => {
    let total = 0;
    let seen = false;
    for (const d of group.deals) {
      const v = num(pick(d));
      if (v === null) continue;
      total += v;
      seen = true;
    }
    return seen ? total : null;
  };

  return {
    volume: entry.volume,
    entryPrice: entry.price,
    exitPrice: closed ? exit.price : null,
    entryAt: earliest(entries.map((d) => d.brokerTime ?? d.time)),
    exitAt: closed ? latest(exits.map((d) => d.brokerTime ?? d.time)) : null,
    commission: sum((d) => d.commission),
    swap: sum((d) => d.swap),
    grossProfit: closed ? sum((d) => d.profit) : null,
    state: closed ? "closed" : "open",
  };
}

/** The evidence class for a broker account, decided by ownership, not by hope. */
export function evidenceClassFor(isBenchmarkAccount: boolean): EvidenceClass {
  return isBenchmarkAccount ? "benchmark" : "customer";
}

/**
 * Prompt 14 Stage 4 closure (F) — broker stop provenance.
 *
 * `actual_initial_stop` must be the stop THE BROKER holds, not the stop
 * P-Trades asked for. They differ whenever a broker adjusts or rejects a level.
 * Resolution order, each strictly broker-reported:
 *   1. the open position matched to this group
 *   2. the order that opened it (history order)
 * Nothing matched, or no stop attached, yields `null` with an explicit source so
 * downstream R math can declare the input unavailable instead of guessing.
 */
export type StopSource = "broker_position" | "broker_order" | "broker_reported_none" | "unknown";

export interface BrokerStop {
  stop: number | null;
  source: StopSource;
}

function stopOf(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function resolveBrokerStop(
  group: DealGroup,
  positions: readonly { id?: string | null; clientId?: string | null; stopLoss?: number | null }[],
  orders: readonly {
    id?: string | null;
    positionId?: string | null;
    clientId?: string | null;
    stopLoss?: number | null;
  }[],
): BrokerStop {
  const position = positions.find(
    (p) =>
      (group.brokerPositionId !== null && p.id === group.brokerPositionId) ||
      (p.clientId !== null && p.clientId === group.clientId),
  );
  if (position) {
    const stop = stopOf(position.stopLoss);
    return { stop, source: stop === null ? "broker_reported_none" : "broker_position" };
  }

  const order = orders.find(
    (o) =>
      (group.brokerOrderId !== null && o.id === group.brokerOrderId) ||
      (group.brokerPositionId !== null && o.positionId === group.brokerPositionId) ||
      (o.clientId !== null && o.clientId === group.clientId),
  );
  if (order) {
    const stop = stopOf(order.stopLoss);
    return { stop, source: stop === null ? "broker_reported_none" : "broker_order" };
  }

  return { stop: null, source: "unknown" };
}
