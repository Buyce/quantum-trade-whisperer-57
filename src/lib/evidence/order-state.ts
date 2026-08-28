/**
 * Broker-confirmed lifecycle of ONE automatic order.
 *
 * Pure and deterministic: it answers "what does the broker say about this order
 * right now?" from what the broker actually returned — pending orders, open
 * positions, history orders and matched evidence. It never guesses from time,
 * proximity or the absence of data: when nothing positively identifies the
 * order, the answer is `unresolved`, not `absent`.
 *
 * Capacity, expiry and History wording all read this single answer, so a closed
 * or vanished order stops occupying a slot while a genuinely resting order keeps
 * holding one.
 */

export type BrokerOrderState =
  /** The broker still holds an unfilled pending order. Occupies a slot. */
  | "resting"
  /** A position exists at the broker. Occupies a slot. */
  | "open"
  /** Broker-confirmed closed evidence. Frees the slot. */
  | "closed"
  /** The broker cancelled, rejected or expired the order. Frees the slot. */
  | "cancelled"
  /** The broker positively no longer lists it anywhere. Frees the slot. */
  | "absent"
  /** Broker state could not be established this pass. Keeps its slot. */
  | "unresolved";

/** States that still consume the owner's concurrent-order ceiling. */
export const OCCUPYING_BROKER_STATES: readonly BrokerOrderState[] = [
  "resting",
  "open",
  "unresolved",
];

export function occupiesSlot(state: BrokerOrderState | null | undefined): boolean {
  if (!state) return true; // never observed yet ⇒ fail closed
  return OCCUPYING_BROKER_STATES.includes(state);
}

/** MetaTrader history-order states that mean "this order will never fill". */
const DEAD_ORDER_STATES = [
  "ORDER_STATE_CANCELED",
  "ORDER_STATE_CANCELLED",
  "ORDER_STATE_REJECTED",
  "ORDER_STATE_EXPIRED",
];

export interface BrokerOrderView {
  /** Broker order id P-Trades recorded at submission, when it has one. */
  brokerOrderId: string | null;
  /** Evidence state matched to this delivery, when reconciliation found any. */
  evidenceState: "open" | "closed" | null;
  /** Currently resting pending orders at the broker. */
  restingOrderIds: readonly string[];
  /** Currently open positions at the broker (position or originating order id). */
  positionIds: readonly string[];
  /** History-order id → broker-reported state. */
  historyOrderStates: ReadonlyMap<string, string>;
  /** False when the broker could not be read this pass. */
  brokerReadable: boolean;
}

export function resolveBrokerOrderState(view: BrokerOrderView): BrokerOrderState {
  // Evidence is the strongest statement: a matched deal proves a fill happened.
  if (view.evidenceState === "closed") return "closed";
  if (view.evidenceState === "open") return "open";
  if (!view.brokerReadable) return "unresolved";

  const id = view.brokerOrderId;
  if (!id) return "unresolved";

  if (view.positionIds.some((pid) => String(pid) === id)) return "open";
  if (view.restingOrderIds.some((oid) => String(oid) === id)) return "resting";

  const historyState = view.historyOrderStates.get(id);
  if (historyState) {
    const upper = historyState.toUpperCase();
    if (DEAD_ORDER_STATES.includes(upper)) return "cancelled";
    if (upper === "ORDER_STATE_FILLED" || upper === "ORDER_STATE_PARTIAL") {
      // The broker filled it, but no deal has been associated yet. It is a real
      // trade in the making: hold the slot until evidence resolves it.
      return "unresolved";
    }
    if (upper === "ORDER_STATE_PLACED" || upper === "ORDER_STATE_STARTED") return "resting";
  }

  // The broker was readable and lists this order nowhere: it is gone.
  return "absent";
}
