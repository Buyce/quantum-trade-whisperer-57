/**
 * Pure matching logic for the losing-run cancel response.
 *
 * When a consecutive-loss pause starts, the owner may choose to cancel any of
 * their still-unfilled automatic orders that are the same bet as the losses
 * that triggered the pause: same instrument (broker symbol) and same direction.
 *
 * This module is deliberately pure: it sees only closed-loss references and the
 * current unfilled delivery ledger. No fetch, no clock, no database.
 */

export interface ClosedLossRef {
  /** Broker symbol as recorded by the broker (e.g. "XAUUSD"). */
  instrument: string | null;
  /** "long" or "short". */
  direction: string | null;
}

export interface UnfilledDeliveryRef {
  /** Delivery primary key. */
  id: number;
  /** Broker symbol the delivery was sent with, if already known. */
  instrument: string | null;
  /** "long" or "short". */
  direction: string | null;
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
 * - A delivery with unknown instrument or direction is never returned.
 * - Duplicate loss references do not return a delivery twice.
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
    const instrument = normaliseInstrument(delivery.instrument);
    const direction = normaliseDirection(delivery.direction);
    if (!instrument || !direction) continue;
    if (keySet.has(`${instrument}:${direction}`)) matched.add(delivery.id);
  }
  return [...matched];
}
