/**
 * Prompt 14 Stage 5 — the ACCOUNT-WIDE BROKER exposure boundary, as pure rules.
 *
 * This is deliberately NOT the Prompt-13 journal exposure advisory. That one
 * describes what the trader logged; this one describes what actually exists at
 * the broker right now. The two are never merged and never substituted for one
 * another:
 *
 *  - journal exposure  = SELF-REPORTED, advisory unless opted in;
 *  - broker exposure   = BROKER-DERIVED, and it BLOCKS a direct submission.
 *
 * Fail-closed: when the broker cannot be read the answer is "refuse (data
 * unavailable)". Assuming the account is flat is exactly the mistake that turns
 * one order into an accidental pyramid.
 *
 * Pure: no fetch, no clock.
 */

export interface BrokerExposureReading {
  /** FALSE when the broker could not be read at all. */
  readable: boolean;
  /** Why it could not be read, when `readable` is false. */
  unreadableReason?: string | null;
  /** Open positions the broker reports on this account, from any source. */
  openPositions: number;
  /** Pending orders the broker reports on this account, from any source. */
  pendingOrders: number;
}

export interface AccountExposureBoundary {
  /**
   * Maximum number of broker-side positions + pending orders this account may
   * carry, counting the one about to be submitted. Null ⇒ no boundary
   * configured, which is permitted (the operator decides), and is reported.
   */
  maxAccountOpenPositions: number | null;
}

export type AccountExposureVerdict =
  | { allowed: true; configured: boolean; brokerOpen: number; brokerPending: number }
  | { allowed: false; detail: string };

/**
 * May one more order be added to this account, given what the BROKER reports?
 *
 * The order about to be submitted is counted, so a boundary of 1 means "at most
 * one thing on this account at a time".
 */
export function evaluateAccountExposure(
  reading: BrokerExposureReading,
  boundary: AccountExposureBoundary,
): AccountExposureVerdict {
  if (!reading.readable) {
    return {
      allowed: false,
      detail:
        reading.unreadableReason?.trim() ||
        "your broker's open positions could not be read, so P-Trades will not add another order",
    };
  }

  const open = Number.isFinite(reading.openPositions) ? Math.max(0, reading.openPositions) : null;
  const pending = Number.isFinite(reading.pendingOrders)
    ? Math.max(0, reading.pendingOrders)
    : null;
  if (open === null || pending === null) {
    return {
      allowed: false,
      detail: "your broker's position and order counts were not usable numbers",
    };
  }

  const limit = boundary.maxAccountOpenPositions;
  if (limit === null || !Number.isFinite(limit)) {
    return { allowed: true, configured: false, brokerOpen: open, brokerPending: pending };
  }
  if (limit <= 0) {
    return {
      allowed: false,
      detail: "this account's broker exposure boundary is set to zero, so no order may be added",
    };
  }

  const wouldBe = open + pending + 1;
  if (wouldBe > limit) {
    return {
      allowed: false,
      detail: `your broker already reports ${open} open position(s) and ${pending} pending order(s) on this account; one more would exceed the boundary of ${limit}`,
    };
  }
  return { allowed: true, configured: true, brokerOpen: open, brokerPending: pending };
}

/** Plain-language description of the two exposure sources, used by the UI. */
export const EXPOSURE_SOURCE_NOTE = {
  broker:
    "BROKER-DERIVED: positions and pending orders your broker reports on this account right now, from any source including your own manual trades.",
  journal:
    "SELF-REPORTED: risk you recorded in the P-Trades journal. It says nothing about what exists at your broker.",
} as const;
