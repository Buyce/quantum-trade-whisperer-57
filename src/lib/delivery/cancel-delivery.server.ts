/**
 * Broker-confirmed cancellation of a single delivery.
 *
 * Reuses the same safety rules as the unfilled-order sweeper:
 * - never-submitted rows are settled directly (nothing exists at the broker),
 * - submitted rows are checked against live broker data and cancelled only when
 *   the broker lists them as resting,
 * - filled or partly-filled rows are left alone,
 * - broker-absent rows are settled as expired,
 * - unconfirmed broker cancellations leave the row untouched for retry.
 *
 * The reason written to the row is caller-supplied so the ledger shows why the
 * row was settled (e.g. "cancelled_by_losing_run").
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  classifyBrokerPresence,
  neverSubmitted,
  settleExpired,
  type SweepableDelivery,
} from "./expire-unfilled.server";
import { isTerminal, type DeliveryState } from "./execution";

export interface CancelDeliveryResult {
  deliveryId: number;
  action: "expired" | "kept";
  reason: string;
}

type Db = Pick<SupabaseClient, "from">;

/** How far back closed broker order history is read to prove a non-fill. */
const HISTORY_LOOKBACK_MS = 7 * 24 * 3_600_000;

/** States that can still be holding a slot open. */
const SWEEPABLE_STATES = ["pending", "claimed", "sent", "acknowledged", "unknown"] as const;

/** True when this row is in a state that may be cancelled. */
function isCancellable(row: SweepableDelivery): boolean {
  if (
    isTerminal(row.state as DeliveryState) &&
    row.state !== "acknowledged" &&
    row.state !== "unknown"
  ) {
    return false;
  }
  return SWEEPABLE_STATES.includes(row.state as (typeof SWEEPABLE_STATES)[number]);
}

/**
 * Attempts to cancel ONE delivery and settle it on confirmed success.
 * Never throws: a failed cancellation is reported as "kept" so the caller can
 * decide what to do next rather than losing the error.
 */
export async function cancelDeliveryById(
  db: Db,
  row: SweepableDelivery,
  callerReason: string,
  now = Date.now(),
): Promise<CancelDeliveryResult> {
  if (!isCancellable(row)) {
    return {
      deliveryId: row.id,
      action: "kept",
      reason: "row is no longer in a cancellable state",
    };
  }

  // A row that never reached the broker can be settled directly.
  if (row.dry_run === true || neverSubmitted(row)) {
    const detail =
      row.dry_run === true
        ? "dry run cleared — nothing was sent to a broker"
        : "never submitted to a broker";
    const reason = `${callerReason}: ${detail}`;
    await settleExpired(db as SupabaseClient, row.id, reason);
    return { deliveryId: row.id, action: "expired", reason };
  }

  if (row.destination_type !== "metaapi_direct" || !row.connected_account_id) {
    return {
      deliveryId: row.id,
      action: "kept",
      reason: "submitted to a destination P-Trades cannot cancel on your behalf",
    };
  }
  if (!row.broker_order_id) {
    return {
      deliveryId: row.id,
      action: "kept",
      reason: "submitted but no broker order id was confirmed, so nothing may be cancelled",
    };
  }

  const { data: accountRow, error: accountError } = await db
    .from("connected_trading_accounts")
    .select("metaapi_account_id, region")
    .eq("id", row.connected_account_id)
    .maybeSingle();
  const account = accountRow as { metaapi_account_id?: string; region?: string } | null;
  if (accountError || !account?.metaapi_account_id || !account?.region) {
    return {
      deliveryId: row.id,
      action: "kept",
      reason: "the broker account behind this order could not be read",
    };
  }

  try {
    const { fetchOrders, fetchPositions } = await import("@/lib/metaapi/accounts.server");
    const { fetchHistoryOrders } = await import("@/lib/metaapi/history.server");
    const { cancelOrder } = await import("@/lib/metaapi/trade.server");
    const [orders, positions, historyOrders] = await Promise.all([
      fetchOrders(account.metaapi_account_id, account.region),
      fetchPositions(account.metaapi_account_id, account.region),
      fetchHistoryOrders(
        account.metaapi_account_id,
        account.region,
        new Date(now - HISTORY_LOOKBACK_MS),
        new Date(now),
      ),
    ]);
    const presence = classifyBrokerPresence(row.broker_order_id, orders, positions, historyOrders);
    if (presence === "filled") {
      return {
        deliveryId: row.id,
        action: "kept",
        reason: "the broker filled this order, so it is a real trade and is never cancelled",
      };
    }
    if (presence === "absent") {
      const reason = `${callerReason}: the broker no longer lists this order, so no order is resting and no position exists`;
      await settleExpired(db as SupabaseClient, row.id, reason);
      return { deliveryId: row.id, action: "expired", reason };
    }

    const verdict = await cancelOrder(
      account.metaapi_account_id,
      account.region,
      row.broker_order_id,
    );
    if (verdict.outcome !== "accepted") {
      return {
        deliveryId: row.id,
        action: "kept",
        reason: `the broker did not confirm the cancellation (${
          verdict.message ?? verdict.stringCode ?? verdict.outcome
        })`,
      };
    }
    const reason = `${callerReason}: broker confirmed the cancellation of the unfilled resting order`;
    await settleExpired(db as SupabaseClient, row.id, reason);
    return { deliveryId: row.id, action: "expired", reason };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[cancel-delivery] broker step failed", { id: row.id, detail });
    return {
      deliveryId: row.id,
      action: "kept",
      reason: `the broker could not be reached to clear this order (${detail})`,
    };
  }
}
