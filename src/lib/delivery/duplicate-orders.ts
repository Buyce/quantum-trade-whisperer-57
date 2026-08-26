/**
 * One live automatic order per setup.
 *
 * WHY. The scanner republishes a still-valid structure on every cycle with the
 * same planned entry. Each republish used to become another live broker order,
 * so one EURUSD short ended up as six resting sell limits at exactly the same
 * price, each sized as if it were the only one. If price ever touched that entry
 * they would all fill together — several times the risk the owner sized for.
 *
 * WHAT this is. A pure comparison used as an ADDITIONAL refusal: if the owner
 * already has an untouched automatic order for the same instrument, the same
 * direction and effectively the same entry, the new attempt is refused and
 * recorded. It never authorises an order, never widens a ceiling and never
 * touches a filled, cancelled or expired row.
 *
 * "Effectively the same entry" means within one broker tick. When the tick size
 * is unknown the comparison falls back to exact equality, so an unknown tick can
 * only ever make this check narrower — never invent a duplicate that is not one.
 */

export interface OrderPlanIdentity {
  instrument: string;
  direction: string | null;
  /** The planned entry price. `null` means "cannot be compared". */
  entry: number | null;
}

/** A resting or in-flight automatic order already held for this owner. */
export interface RestingOrder extends OrderPlanIdentity {
  deliveryId: number;
  /** The signal behind it, so the same signal never blocks itself. */
  signalId: string | null;
}

function sameInstrument(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function sameDirection(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * True when `existing` is, for order purposes, the same plan as `candidate`.
 * Fails CLOSED towards allowing the order: anything unreadable (missing entry,
 * missing direction) is NOT called a duplicate.
 */
export function isSameOrderPlan(
  candidate: OrderPlanIdentity,
  existing: OrderPlanIdentity,
  tickSize: number | null,
): boolean {
  if (!sameInstrument(candidate.instrument, existing.instrument)) return false;
  if (!sameDirection(candidate.direction, existing.direction)) return false;
  if (candidate.entry === null || existing.entry === null) return false;
  if (!Number.isFinite(candidate.entry) || !Number.isFinite(existing.entry)) return false;
  const tolerance = tickSize !== null && Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0;
  // Binary floating point makes an exact one-tick difference land a hair above
  // the tick, so the comparison allows a tiny relative slack. It is far below a
  // tick and cannot merge two genuinely different prices.
  const slack = Math.max(Math.abs(candidate.entry), Math.abs(existing.entry)) * 1e-9;
  return Math.abs(candidate.entry - existing.entry) <= tolerance + slack;
}

/**
 * The first already-held order that duplicates this plan, or `null`. The owner's
 * own signal is skipped: the delivery upsert key already makes one signal
 * idempotent, and a signal must never block itself.
 */
export function findDuplicateOrder(
  candidate: OrderPlanIdentity & { signalId: string },
  held: readonly RestingOrder[],
  tickSize: number | null,
): RestingOrder | null {
  for (const order of held) {
    if (order.signalId !== null && order.signalId === candidate.signalId) continue;
    if (isSameOrderPlan(candidate, order, tickSize)) return order;
  }
  return null;
}

/** Operator-safe explanation naming the order that already holds this setup. */
export function describeDuplicateOrder(order: RestingOrder): string {
  const entry = order.entry === null ? "an unrecorded entry" : `entry ${order.entry}`;
  return `automatic order #${order.deliveryId} is already live on ${order.instrument.toUpperCase()} ${
    order.direction ?? "unknown direction"
  } at ${entry}`;
}
