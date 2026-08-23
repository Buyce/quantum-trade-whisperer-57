/**
 * Pure interpretation of a MetaApi trade response.
 *
 * The critical case is UNKNOWN: a timeout or an unrecognised code means we do
 * not know whether the broker accepted the order. That must never collapse into
 * "rejected" (which would invite a duplicate submission) nor into "accepted"
 * (which would fabricate a position). Callers reconcile UNKNOWN against broker
 * orders/deals by clientId before ever retrying.
 */
import type { TradeResponse } from "./types";

export type TradeOutcome = "accepted" | "rejected" | "unknown";

export interface TradeVerdict {
  outcome: TradeOutcome;
  numericCode: number | null;
  stringCode: string | null;
  message: string | null;
  orderId: string | null;
  positionId: string | null;
  /** TRUE only when a fresh submission is safe (broker definitively refused). */
  safeToResubmit: boolean;
}

/** MT5 `TRADE_RETCODE` success family plus the MT4 `ERR_NO_ERROR` code. */
const ACCEPTED_CODES = new Set([0, 10008, 10009, 10010]);

/**
 * Definitive broker refusals: nothing was placed, so a corrected submission is
 * safe. Anything outside this set (including 10004/10021 requotes and any
 * unmapped code) stays UNKNOWN and requires reconciliation.
 */
const REJECTED_CODES = new Set([
  10006, // request rejected
  10007, // request cancelled by trader
  10011, // request processing error
  10013, // invalid request
  10014, // invalid volume
  10015, // invalid price
  10016, // invalid stops
  10017, // trade disabled
  10018, // market closed
  10019, // insufficient funds
  10020, // prices changed
  10022, // invalid order expiration
  10026, // autotrading disabled by server
  10027, // autotrading disabled by client terminal
  10030, // unsupported filling mode
  10031, // no connection with the trade server
  10034, // volume/order limit reached
]);

export function interpretTradeResponse(res: TradeResponse | null | undefined): TradeVerdict {
  const numericCode =
    typeof res?.numericCode === "number" && Number.isFinite(res.numericCode)
      ? res.numericCode
      : null;
  const base = {
    numericCode,
    stringCode: res?.stringCode ?? null,
    message: res?.message ?? null,
    orderId: res?.orderId ?? null,
    positionId: res?.positionId ?? null,
  };

  if (numericCode !== null && ACCEPTED_CODES.has(numericCode)) {
    return { ...base, outcome: "accepted", safeToResubmit: false };
  }
  if (numericCode !== null && REJECTED_CODES.has(numericCode)) {
    return { ...base, outcome: "rejected", safeToResubmit: true };
  }
  return { ...base, outcome: "unknown", safeToResubmit: false };
}
