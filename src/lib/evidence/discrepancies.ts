/**
 * Reconciliation discrepancies — pure comparison of what the broker reports
 * against what P-Trades has recorded. FLAG ONLY: nothing here corrects either
 * side. Every finding carries both sides' values so a human can review it.
 *
 * Kinds:
 *  - order_missing_at_broker   a delivery we submitted (has a broker order id)
 *                              that the broker has no trace of.
 *  - broker_fill_unmatched     a deal carrying a P-Trades clientId on this
 *                              account with no matching platform delivery.
 *  - position_untracked        an open broker position carrying a P-Trades
 *                              clientId with no matching platform delivery.
 *  - balance_drift             broker balance moved by a different amount than
 *                              the sum of broker deals since the last stored
 *                              balance reading.
 */

export type DiscrepancyKind =
  | "order_missing_at_broker"
  | "broker_fill_unmatched"
  | "position_untracked"
  | "balance_drift";

export type DiscrepancySeverity = "warning" | "critical";

export interface Discrepancy {
  kind: DiscrepancyKind;
  /** Stable reference so a re-seen mismatch updates instead of duplicating. */
  ref: string;
  severity: DiscrepancySeverity;
  summary: string;
  platformValue: Record<string, unknown>;
  brokerValue: Record<string, unknown>;
}

export interface DiscrepancyInput {
  deliveries: readonly {
    id: number;
    client_id: string | null;
    broker_order_id: string | null;
    broker_symbol: string | null;
    account_mode: string | null;
  }[];
  /** Broker order state resolved this pass, per delivery id. */
  brokerStateByDelivery: ReadonlyMap<number, string>;
  /** clientIds of deal groups P-Trades owns on this account. */
  ownedDealClientIds: readonly string[];
  positions: readonly {
    id?: string | null;
    clientId?: string | null;
    symbol?: string | null;
    volume?: number | null;
  }[];
  isPTradesClientId: (clientId: string | null | undefined) => boolean;
  balance: {
    stored: number | null;
    storedAt: string | null;
    broker: number | null;
    currency: string | null;
    /** Deals executed strictly after storedAt. */
    dealsSince: readonly {
      time?: string | null;
      profit?: number | null;
      swap?: number | null;
      commission?: number | null;
      fee?: number | null;
    }[];
    /** Whether the fetched deal history fully covers storedAt → now. */
    historyCovers: boolean;
  } | null;
}

/** Absolute tolerance: the larger of 1 unit or 0.1% of balance. */
export function balanceTolerance(balance: number): number {
  return Math.max(1, Math.abs(balance) * 0.001);
}

export function findDiscrepancies(input: DiscrepancyInput): Discrepancy[] {
  const out: Discrepancy[] = [];
  const deliveryClientIds = new Set(
    input.deliveries.map((d) => d.client_id).filter((c): c is string => !!c),
  );

  for (const d of input.deliveries) {
    if (!d.broker_order_id) continue;
    if (input.brokerStateByDelivery.get(d.id) !== "absent") continue;
    out.push({
      kind: "order_missing_at_broker",
      ref: `delivery:${d.id}`,
      severity: d.account_mode?.startsWith("live") ? "critical" : "warning",
      summary: `Order ${d.broker_order_id} (${d.broker_symbol ?? "unknown symbol"}) is recorded by P-Trades but the broker has no trace of it.`,
      platformValue: { deliveryId: d.id, brokerOrderId: d.broker_order_id },
      brokerValue: { found: false },
    });
  }

  for (const clientId of new Set(input.ownedDealClientIds)) {
    if (deliveryClientIds.has(clientId)) continue;
    out.push({
      kind: "broker_fill_unmatched",
      ref: `client:${clientId}`,
      severity: "warning",
      summary: `The broker reports a fill tagged by P-Trades (${clientId}) that P-Trades has no order record for.`,
      platformValue: { found: false },
      brokerValue: { clientId },
    });
  }

  for (const p of input.positions) {
    const clientId = p.clientId ?? null;
    if (!clientId || !input.isPTradesClientId(clientId)) continue;
    if (deliveryClientIds.has(clientId)) continue;
    out.push({
      kind: "position_untracked",
      ref: `position:${p.id ?? clientId}`,
      severity: "critical",
      summary: `An open ${p.symbol ?? ""} position tagged by P-Trades is at the broker but not in P-Trades' records.`,
      platformValue: { found: false },
      brokerValue: { positionId: p.id ?? null, clientId, symbol: p.symbol ?? null, volume: p.volume ?? null },
    });
  }

  const b = input.balance;
  if (b && b.stored !== null && b.broker !== null && b.storedAt && b.historyCovers) {
    const dealTotal = b.dealsSince.reduce(
      (sum, deal) =>
        sum +
        (deal.profit ?? 0) +
        (deal.swap ?? 0) +
        (deal.commission ?? 0) +
        (deal.fee ?? 0),
      0,
    );
    const expected = b.stored + dealTotal;
    const diff = b.broker - expected;
    if (Math.abs(diff) > balanceTolerance(b.broker)) {
      out.push({
        kind: "balance_drift",
        ref: "balance",
        severity: "warning",
        summary: `Broker balance differs from the last recorded balance plus broker deals by ${diff.toFixed(2)} ${b.currency ?? ""}.`.trim(),
        platformValue: {
          storedBalance: b.stored,
          storedAt: b.storedAt,
          dealTotal: Number(dealTotal.toFixed(2)),
          expected: Number(expected.toFixed(2)),
        },
        brokerValue: { balance: b.broker, currency: b.currency },
      });
    }
  }

  return out;
}
