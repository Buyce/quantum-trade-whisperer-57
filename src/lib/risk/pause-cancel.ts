/**
 * Pure matching logic for the losing-run cancel response.
 *
 * When a consecutive-loss pause starts, the owner may choose to cancel any of
 * their still-unfilled automatic orders that are the same bet as the losses
 * that triggered the pause: same instrument and same direction.
 *
 * This module is deliberately pure: it sees only broker-derived closed-loss rows
 * and the current unfilled delivery ledger. No fetch, no clock, no database.
 */

export interface ClosedLossRef {
  /** Canonical signal instrument (e.g. "XAUUSD"). */
  instrument: string | null;
  /** "long" or "short". */
  direction: string | null;
}

export interface UnfilledDeliveryRef {
  /** Delivery primary key. */
  id: number;
  /** Canonical signal instrument. */
  instrument: string | null;
  /** "long" or "short". */
  direction: string | null;
  /** True only when the broker positively filled some volume. */
  partiallyFilled: boolean;
}

function normaliseInstrument(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseDirection(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().toLowerCase();
  return trimmed === "long" || trimmed === "short" ? trimmed : null;
}

/**
 * Returns the set of unfilled delivery ids that match the instrument and
 * direction of the triggering closed losses.
 *
 * Fail-closed:
 * - A delivery with unknown instrument or direction is never cancelled.
 * - A partially-filled delivery is never cancelled (it is already a position).
 * - Duplicate loss references do not cancel a delivery twice.
 */
export function matchingUnfilledDeliveries(
  losses: readonly ClosedLossRef[],
  unfilled: readonly UnfilledDeliveryRef[],
): number[] {
  const keySet = new Set<string>();
  for (const loss of losses) {
    const instrument = normaliseInstrument(loss.instrument);
    const direction = normaliseDirection(loss.direction);
    if (!instrument || !direction) continue;
    keySet.add(`${instrument}:${direction}`);
  }
  if (keySet.size === 0) return [];

  const matched = new Set<number>();
  for (const delivery of unfilled) {
    if (delivery.partiallyFilled) continue;
    const instrument = normaliseInstrument(delivery.instrument);
    const direction = normaliseDirection(delivery.direction);
    if (!instrument || !direction) continue;
    if (keySet.has(`${instrument}:${direction}`)) matched.add(delivery.id);
  }
  return [...matched];
}
