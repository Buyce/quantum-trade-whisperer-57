/**
 * Automatic broker orders, as Trade History shows them.
 *
 * Everything here is BROKER-DERIVED or ENGINE-DERIVED:
 *  - the order line comes from the `execution_deliveries` ledger row P-Trades
 *    created and settled from the broker's own verdict;
 *  - the outcome line comes from `broker_trade_evidence`, written only when the
 *    reconciler positively associated real broker deals with that order.
 *
 * Nothing is self-reported and nothing is estimated. A submitted order with no
 * matched evidence yet renders as awaiting confirmation, never as a result; a
 * missing R renders through the shared journal display rules, never as 0.00R.
 *
 * This module is pure mapping so it can be tested without a database.
 */
import type { Grade } from "@/lib/db-types";
import { REJECT_COPY, type RejectReason } from "@/lib/delivery/execution";
import { journalRView, type JournalRView } from "@/lib/journal/display";
import type { RBasis } from "@/lib/journal/r-math";

/** Delivery-ledger fields Trade History reads. */
export interface BrokerOrderDeliveryRow {
  id: number;
  signal_id: string | null;
  state: string;
  reason: string | null;
  dry_run: boolean | null;
  account_mode: string | null;
  destination_type: string | null;
  broker_symbol: string | null;
  broker_order_id: string | null;
  broker_retcode_string: string | null;
  entry_mode: string | null;
  /** Last broker-confirmed lifecycle state for this order, when reconciled. */
  broker_order_state?: string | null;
  submitted_volume: number | null;
  submitted_entry: number | null;
  submitted_stop: number | null;
  submitted_target: number | null;
  submitted_at: string | null;
  enqueued_at: string;
}

/** Broker-evidence fields Trade History reads. */
export interface BrokerOrderEvidenceRow {
  state: string;
  broker_account_type: string | null;
  direction: string | null;
  volume: number | null;
  entry_price: number | null;
  exit_price: number | null;
  entry_at: string | null;
  exit_at: string | null;
  gross_profit: number | null;
  commission: number | null;
  swap: number | null;
  profit_currency: string | null;
  r_vs_plan: number | null;
  r_vs_actual_risk: number | null;
  r_availability: string | null;
  stop_provenance: string | null;
}

/** Signal snapshot fields Trade History reads. */
export interface BrokerOrderSignalRow {
  instrument: string;
  grade: string;
  direction: string;
  detected_at: string;
  entry_price: number | null;
  stop_loss: number | null;
  tp1: number | null;
  rr_ratio: number | null;
}

export type BrokerOrderStatusKind =
  | "queued"
  | "submitting"
  | "awaiting_confirmation"
  | "accepted"
  | "open_at_broker"
  | "closed_at_broker"
  | "rejected"
  | "not_sent"
  | "failed"
  | "unknown";

export interface BrokerOrderDestination {
  kind: "broker_account" | "webhook_bridge" | "unknown";
  /** Short user-facing label naming the destination. */
  label: string;
}

export interface BrokerOrderStatus {
  kind: BrokerOrderStatusKind;
  /** Short user-facing label. Never claims an outcome the broker did not give. */
  label: string;
  /** Why, when the broker or the engine gave a reason. */
  detail: string | null;
}

export interface BrokerOrderView {
  /** Render key only. */
  key: string;
  deliveryId: number;
  instrument: string;
  grade: Grade | "Unknown";
  direction: "long" | "short" | null;
  detectedAt: string | null;
  enqueuedAt: string;
  /** Broker-reported account classification, or null when the broker has not said. */
  accountType: "demo" | "real" | "unknown" | null;
  /**
   * WHERE this order was addressed. A webhook bridge row is not the connected
   * broker account, so a dry-run bridge row must never read as "your demo
   * account did nothing".
   */
  destination: BrokerOrderDestination;
  dryRun: boolean;
  entryMode: "market" | "pending_limit" | "unknown";
  status: BrokerOrderStatus;
  submitted: {
    volume: number | null;
    entry: number | null;
    stop: number | null;
    target: number | null;
    at: string | null;
    brokerSymbol: string | null;
  };
  /** Present only when real broker deals were positively associated. */
  broker: {
    state: "open" | "closed" | string;
    entryPrice: number | null;
    exitPrice: number | null;
    volume: number | null;
    entryAt: string | null;
    exitAt: string | null;
    grossProfit: number | null;
    commission: number | null;
    swap: number | null;
    currency: string | null;
  } | null;
  /** Shared journal R presentation: value, basis and the reason it is missing. */
  r: JournalRView;
  /** Plan snapshot the order was measured against, when the signal is retained. */
  plan: { entry: number | null; stop: number | null; target: number | null; rr: number | null };
}

const GRADES = new Set(["A+", "A", "B", "C"]);

/**
 * Plain-language text for a P-Trades pre-send refusal. The named reason may carry
 * a `: detail` suffix; the reason itself is translated and the detail is kept, so
 * nothing is invented and nothing is hidden.
 */
function engineRefusalCopy(reason: string | null): string | null {
  if (!reason) return "P-Trades did not submit this order and recorded no reason.";
  const [name, ...rest] = reason.split(":");
  const key = (name ?? "").trim() as RejectReason;
  const copy = REJECT_COPY[key];
  const detail = rest.join(":").trim();
  if (!copy) return reason;
  return detail ? `${copy} (${detail})` : copy;
}

function grade(value: string | null | undefined): Grade | "Unknown" {
  return value && GRADES.has(value) ? (value as Grade) : "Unknown";
}

function direction(value: string | null | undefined): "long" | "short" | null {
  return value === "long" || value === "short" ? value : null;
}

function accountType(value: string | null | undefined): BrokerOrderView["accountType"] {
  if (value === "demo" || value === "real" || value === "unknown") return value;
  return null;
}

/** Where the order was addressed, from the ledger's own destination field. */
export function brokerOrderDestination(
  destinationType: string | null | undefined,
): BrokerOrderDestination {
  if (destinationType === "metaapi_direct") {
    return { kind: "broker_account", label: "Connected broker account" };
  }
  if (destinationType === "bridge_json" || destinationType === "bridge_form") {
    return { kind: "webhook_bridge", label: "Your webhook bridge" };
  }
  return { kind: "unknown", label: "Destination not recorded" };
}

/**
 * What the user is told about this order.
 *
 * Broker evidence wins when it exists, because it is the broker's own record.
 * Otherwise the delivery state is reported as-is: a `sent` row is explicitly
 * "awaiting broker confirmation", never a fill.
 */
export function brokerOrderStatus(
  delivery: Pick<
    BrokerOrderDeliveryRow,
    "state" | "reason" | "broker_retcode_string" | "submitted_at" | "broker_order_state"
  >,
  evidence: Pick<BrokerOrderEvidenceRow, "state"> | null,
): BrokerOrderStatus {
  if (evidence) {
    if (evidence.state === "open") {
      return {
        kind: "open_at_broker",
        label: "Open at the broker",
        detail: "The broker still holds this position, so there is no result yet.",
      };
    }
    if (evidence.state === "closed") {
      return { kind: "closed_at_broker", label: "Closed at the broker", detail: null };
    }
  }

  const detail = delivery.broker_retcode_string ?? delivery.reason ?? null;
  // A refusal that never left P-Trades is not the broker's verdict. Only a row
  // carrying a broker return code, or a recorded submission, may be attributed to
  // the broker at all.
  const submittedToBroker =
    delivery.broker_retcode_string !== null || delivery.submitted_at !== null;
  if (!submittedToBroker && (delivery.state === "rejected" || delivery.state === "unknown")) {
    return {
      kind: "not_sent",
      label: "Not sent — refused by P-Trades",
      detail: engineRefusalCopy(delivery.reason),
    };
  }
  switch (delivery.state) {
    case "pending":
      return {
        kind: "queued",
        label: "Queued",
        detail: "Waiting to be submitted to your broker.",
      };
    case "claimed":
      return { kind: "submitting", label: "Submitting", detail };
    case "sent":
      return {
        kind: "awaiting_confirmation",
        label: "Awaiting broker confirmation",
        detail: detail ?? "Submitted; the broker has not confirmed an order yet.",
      };
    case "acknowledged":
      // Only the LAST broker reconciliation may say an order is resting. The
      // absence of evidence proves nothing on its own.
      if (delivery.broker_order_state === "resting") {
        return {
          kind: "accepted",
          label: "Resting at your broker — not filled",
          detail: "The broker confirmed this order is still waiting unfilled at your entry price.",
        };
      }
      if (delivery.broker_order_state === "cancelled" || delivery.broker_order_state === "absent") {
        return {
          kind: "not_sent",
          label: "Cleared at your broker — no trade",
          detail:
            "Your broker no longer holds this order and no position resulted from it, so its slot was freed.",
        };
      }
      return {
        kind: "accepted",
        label: "Accepted by broker — awaiting evidence",
        detail:
          detail ??
          "The broker accepted this order, but no associated entry deal has been reconciled yet.",
      };
    case "rejected":
      return { kind: "rejected", label: "Rejected by broker", detail };
    case "failed":
      return { kind: "failed", label: "Not submitted", detail };
    case "expired":
      return {
        kind: "not_sent",
        label: "Cleared — not filled in your order window",
        detail:
          detail ??
          "Your broker did not turn this order into a position within your automatic-order window, so it was cleared and its slot freed. No trade resulted from it.",
      };

    default:
      return {
        kind: "unknown",
        label: "Outcome unknown",
        detail:
          detail ??
          "The submission was not confirmed either way, so P-Trades makes no claim about it.",
      };
  }
}

/** Does this order still have an outcome that could arrive later? */
export function brokerOrderPending(view: BrokerOrderView): boolean {
  return (
    view.status.kind === "queued" ||
    view.status.kind === "submitting" ||
    view.status.kind === "awaiting_confirmation" ||
    view.status.kind === "accepted" ||
    view.status.kind === "open_at_broker" ||
    view.status.kind === "unknown"
  );
}

/**
 * Maps one delivery (plus whatever the broker confirmed) into the row the UI
 * renders. `basis` selects which R is shown, exactly as the journal does.
 */
export function toBrokerOrderView(
  delivery: BrokerOrderDeliveryRow,
  evidence: BrokerOrderEvidenceRow | null,
  signal: BrokerOrderSignalRow | null,
  basis: RBasis = "actual_risk",
): BrokerOrderView {
  const status = brokerOrderStatus(delivery, evidence);
  const open = evidence?.state === "open";
  // An open position has no realized R, so any R still on the row is in-flight
  // bookkeeping and must not be rendered as a result.
  const r =
    evidence && !open
      ? journalRView(
          {
            outcome: "closed",
            r_vs_plan: evidence.r_vs_plan,
            r_vs_actual_risk: evidence.r_vs_actual_risk,
            r_availability: evidence.r_availability,
            stop_provenance: evidence.stop_provenance,
          },
          basis,
        )
      : journalRView({ outcome: "open", r_availability: "unavailable_open" }, basis);

  return {
    key: `delivery-${delivery.id}`,
    deliveryId: delivery.id,
    instrument: signal?.instrument ?? delivery.broker_symbol ?? "—",
    grade: grade(signal?.grade),
    direction: direction(signal?.direction ?? evidence?.direction),
    detectedAt: signal?.detected_at ?? null,
    enqueuedAt: delivery.enqueued_at,
    accountType: accountType(evidence?.broker_account_type),
    destination: brokerOrderDestination(delivery.destination_type),
    dryRun: delivery.dry_run === true,
    entryMode:
      delivery.entry_mode === "market" || delivery.entry_mode === "pending_limit"
        ? delivery.entry_mode
        : "unknown",
    status,
    submitted: {
      volume: delivery.submitted_volume,
      entry: delivery.submitted_entry,
      stop: delivery.submitted_stop,
      target: delivery.submitted_target,
      at: delivery.submitted_at,
      brokerSymbol: delivery.broker_symbol,
    },
    broker: evidence
      ? {
          state: evidence.state,
          entryPrice: evidence.entry_price,
          exitPrice: evidence.exit_price,
          volume: evidence.volume,
          entryAt: evidence.entry_at,
          exitAt: evidence.exit_at,
          grossProfit: evidence.gross_profit,
          commission: evidence.commission,
          swap: evidence.swap,
          currency: evidence.profit_currency,
        }
      : null,
    r,
    plan: {
      entry: signal?.entry_price ?? null,
      stop: signal?.stop_loss ?? null,
      target: signal?.tp1 ?? null,
      rr: signal?.rr_ratio ?? null,
    },
  };
}
