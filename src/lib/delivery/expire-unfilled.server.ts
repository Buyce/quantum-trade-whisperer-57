/**
 * The unfilled-order sweeper.
 *
 * An automatic order that the broker never turned into a position keeps
 * occupying the owner's "open at once" ceiling forever. This worker gives those
 * slots back after {@link UNFILLED_ORDER_TIMEOUT_MS} — WITHOUT ever pretending
 * something happened at the broker that did not:
 *
 *  - never submitted (`pending` / `claimed`, no `submitted_at`, no broker order
 *    id) ⇒ settled `expired` directly. Nothing exists at the broker to cancel.
 *  - submitted and still resting at the broker as an unfilled pending order ⇒ we
 *    ask the broker to cancel it, and only a CONFIRMED cancellation settles the
 *    row `expired`.
 *  - filled, partially filled, or already a position ⇒ left completely alone.
 *  - broker unreadable, cancellation refused, or the order cannot be found ⇒ the
 *    row is left as it is and re-examined next pass. An unproven cancellation
 *    frees no slot.
 *
 * Rows are SETTLED, never deleted: History must keep showing what happened.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { UNFILLED_ORDER_TIMEOUT_MS, isTerminal, type DeliveryState } from "./execution";

type Db = Pick<SupabaseClient, "from">;

/** How far back closed broker order history is read to prove a non-fill. */
export const HISTORY_LOOKBACK_MS = 7 * 24 * 3_600_000;

/** How many deliveries one pass may examine. Bounded by design. */
export const MAX_EXPIRIES_PER_RUN = 25;

/** States that can still be holding a slot open. */
const SWEEPABLE_STATES = ["pending", "claimed", "sent", "acknowledged", "unknown"] as const;

export interface SweepableDelivery {
  id: number;
  user_id: string | null;
  state: DeliveryState | string;
  dry_run: boolean | null;
  enqueued_at: string | null;
  sent_at: string | null;
  submitted_at: string | null;
  broker_order_id: string | null;
  connected_account_id: string | null;
  destination_type: string | null;
}

/**
 * How long THIS owner's order may rest before the sweeper considers clearing it.
 *
 * The owner's automatic-order window is the honest answer: an order they told
 * P-Trades to keep working for three hours must not be cancelled after one.
 * A missing, unreadable or zero window falls back to
 * {@link UNFILLED_ORDER_TIMEOUT_MS}, so an unreadable setting can never keep an
 * order resting indefinitely.
 */
export function ownerTimeoutMs(windowMinutes: number | null | undefined): number {
  if (windowMinutes === null || windowMinutes === undefined) return UNFILLED_ORDER_TIMEOUT_MS;
  const minutes = Number(windowMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return UNFILLED_ORDER_TIMEOUT_MS;
  return Math.min(minutes, 360) * 60_000;
}

export type ExpiryOutcome =
  /** Settled `expired`; the slot is now free. */
  | { deliveryId: number; action: "expired"; reason: string }
  /** Deliberately untouched (filled, unreadable, or unconfirmed cancellation). */
  | { deliveryId: number; action: "kept"; reason: string };

/** True when this row has waited long enough to be swept. */
export function isUnfilledTooLong(
  delivery: Pick<SweepableDelivery, "enqueued_at" | "sent_at">,
  now: number,
  timeoutMs = UNFILLED_ORDER_TIMEOUT_MS,
): boolean {
  const stamp = delivery.sent_at ?? delivery.enqueued_at;
  if (!stamp) return false;
  const at = Date.parse(stamp);
  if (!Number.isFinite(at)) return false;
  return now - at >= timeoutMs;
}

/**
 * True when nothing was ever submitted for this delivery, so there is provably
 * no broker order behind it. Fails CLOSED: any hint of a submission (a recorded
 * submission time, a broker order id, or a `sent` state) means "ask the broker".
 */
export function neverSubmitted(
  delivery: Pick<SweepableDelivery, "state" | "submitted_at" | "broker_order_id" | "sent_at">,
): boolean {
  if (delivery.submitted_at !== null) return false;
  if (delivery.broker_order_id !== null) return false;
  if (delivery.sent_at !== null) return false;
  // `unknown` is the retry state a delivery lands in when a pre-send gate could
  // not be evaluated. With no submission stamp, no broker order id and no send
  // stamp, nothing ever reached a broker, so the slot is ours to reclaim —
  // otherwise these rows hold automatic-order capacity forever.
  return (
    delivery.state === "pending" || delivery.state === "claimed" || delivery.state === "unknown"
  );
}


/**
 * Classifies what the broker currently holds for this order id.
 *
 * `resting` — an unfilled pending order that may be cancelled.
 * `filled`  — a position, or an order with volume already filled. Never touched.
 * `absent`  — the broker knows nothing about it; no cancellation is possible, so
 *             the row is left for the evidence reconciler instead.
 */
export type BrokerOrderPresence = "resting" | "filled" | "absent";

export function classifyBrokerPresence(
  orderId: string,
  orders: readonly { id?: string | null; currentVolume?: number | null; volume?: number | null }[],
  positions: readonly { id?: string | null }[],
  /**
   * Closed broker history for the same window. An order the broker already
   * FILLED is gone from both live lists, so without history a real trade looks
   * "absent" and gets settled as never filled — exactly how P-Trades previously
   * mislabelled closed, profitable trades.
   */
  historyOrders: readonly { id?: string | null; state?: string | null }[] = [],
): BrokerOrderPresence {
  if (positions.some((p) => String(p.id ?? "") === orderId)) return "filled";
  const historical = historyOrders.find((o) => String(o.id ?? "") === orderId);
  const historicalState = (historical?.state ?? "").toUpperCase();
  if (historicalState.includes("FILLED")) return "filled";
  const order = orders.find((o) => String(o.id ?? "") === orderId);
  if (!order) return "absent";
  const total = typeof order.volume === "number" ? order.volume : null;
  const remaining = typeof order.currentVolume === "number" ? order.currentVolume : null;
  // A pending order whose remaining volume is below its requested volume has
  // already partially filled, so it is a position in the making — leave it.
  if (total !== null && remaining !== null && remaining < total) return "filled";
  return "resting";
}

async function settleExpired(db: Db, id: number, reason: string): Promise<void> {
  const { error } = await db
    .from("execution_deliveries")
    .update({
      state: "expired",
      reason,
      claimed_at: null,
      lease_expires_at: null,
      settled_at: new Date().toISOString(),
    })
    .eq("id", id)
    // Concurrency guard: never overwrite a state that moved under us.
    .in("state", SWEEPABLE_STATES as unknown as string[]);
  if (error) console.error("[expire-unfilled] settle failed", { id, error: error.message });
}

/**
 * Sweeps one bounded batch. Never throws: clearing stale slots must not be able
 * to interrupt dispatch, the scanner or reconciliation.
 */
export async function expireUnfilledOrders(
  db: SupabaseClient,
  now = Date.now(),
): Promise<ExpiryOutcome[]> {
  const outcomes: ExpiryOutcome[] = [];
  const cutoff = new Date(now - UNFILLED_ORDER_TIMEOUT_MS).toISOString();

  const { data, error } = await db
    .from("execution_deliveries")
    .select(
      "id, user_id, state, dry_run, enqueued_at, sent_at, submitted_at, broker_order_id, connected_account_id, destination_type",
    )
    .in("state", SWEEPABLE_STATES as unknown as string[])
    .lte("enqueued_at", cutoff)
    .order("enqueued_at", { ascending: true })
    .limit(MAX_EXPIRIES_PER_RUN);
  if (error) {
    console.error("[expire-unfilled] read failed", error.message);
    return outcomes;
  }

  const rows = (data ?? []) as unknown as SweepableDelivery[];

  // Each owner's own automatic-order window decides how long their order may rest.
  const owners = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))];
  const windows = new Map<string, number>();
  if (owners.length > 0) {
    const { data: settings, error: settingsError } = await db
      .from("scanner_settings")
      .select("user_id, auto_order_window_minutes")
      .in("user_id", owners);
    if (settingsError) {
      console.error("[expire-unfilled] settings unreadable", settingsError.message);
    } else {
      for (const row of (settings ?? []) as {
        user_id: string;
        auto_order_window_minutes: number | null;
      }[]) {
        windows.set(row.user_id, ownerTimeoutMs(row.auto_order_window_minutes));
      }
    }
  }

  for (const row of rows) {
    if (isTerminal(row.state as DeliveryState) && row.state !== "acknowledged") continue;
    const timeoutMs = (row.user_id && windows.get(row.user_id)) || UNFILLED_ORDER_TIMEOUT_MS;
    if (!isUnfilledTooLong(row, now, timeoutMs)) continue;

    // A dry run reached no broker at all, so the slot is free to reclaim.
    if (row.dry_run === true || neverSubmitted(row)) {
      const reason =
        row.dry_run === true
          ? "expired: dry run cleared after the unfilled-order timeout; nothing was sent to a broker"
          : "expired: never submitted to a broker within the unfilled-order timeout";
      await settleExpired(db, row.id, reason);
      outcomes.push({ deliveryId: row.id, action: "expired", reason });
      continue;
    }

    // Beyond this point the order may exist at the broker. Only the broker can
    // authorise clearing it.
    if (row.destination_type !== "metaapi_direct" || !row.connected_account_id) {
      outcomes.push({
        deliveryId: row.id,
        action: "kept",
        reason: "submitted to a destination P-Trades cannot cancel on your behalf",
      });
      continue;
    }
    if (!row.broker_order_id) {
      outcomes.push({
        deliveryId: row.id,
        action: "kept",
        reason: "submitted but no broker order id was confirmed, so nothing may be cancelled",
      });
      continue;
    }

    const { data: accountRow, error: accountError } = await db
      .from("connected_trading_accounts")
      .select("metaapi_account_id, region")
      .eq("id", row.connected_account_id)
      .maybeSingle();
    const account = accountRow as { metaapi_account_id?: string; region?: string } | null;
    if (accountError || !account?.metaapi_account_id || !account?.region) {
      outcomes.push({
        deliveryId: row.id,
        action: "kept",
        reason: "the broker account behind this order could not be read",
      });
      continue;
    }

    try {
      const { fetchOrders, fetchPositions } = await import("@/lib/metaapi/accounts.server");
      const { fetchHistoryOrders } = await import("@/lib/metaapi/history.server");
      const [orders, positions, historyOrders] = await Promise.all([
        fetchOrders(account.metaapi_account_id, account.region),
        fetchPositions(account.metaapi_account_id, account.region),
        // A filled order leaves both live lists, so closed history is what proves
        // "never filled" before any slot is reclaimed.
        fetchHistoryOrders(
          account.metaapi_account_id,
          account.region,
          new Date(now - HISTORY_LOOKBACK_MS),
          new Date(now),
        ),
      ]);
      const presence = classifyBrokerPresence(
        row.broker_order_id,
        orders,
        positions,
        historyOrders,
      );
      if (presence === "filled") {
        outcomes.push({
          deliveryId: row.id,
          action: "kept",
          reason: "the broker filled this order, so it is a real trade and is never cancelled",
        });
        continue;
      }
      if (presence === "absent") {
        // The broker was readable and lists this order nowhere — neither resting
        // nor as a position. Nothing is holding the slot, so it is settled and
        // the reconciler keeps ownership of any evidence that later appears.
        const reason =
          "expired: the broker no longer lists this order, so no order is resting and no position exists";
        await settleExpired(db, row.id, reason);
        outcomes.push({ deliveryId: row.id, action: "expired", reason });
        continue;
      }

      const { cancelOrder } = await import("@/lib/metaapi/trade.server");
      const verdict = await cancelOrder(
        account.metaapi_account_id,
        account.region,
        row.broker_order_id,
      );
      if (verdict.outcome !== "accepted") {
        outcomes.push({
          deliveryId: row.id,
          action: "kept",
          reason: `the broker did not confirm the cancellation (${
            verdict.message ?? verdict.stringCode ?? verdict.outcome
          })`,
        });
        continue;
      }
      const reason =
        "expired: the broker did not fill this order within the unfilled-order timeout, and confirmed its cancellation";
      await settleExpired(db, row.id, reason);
      outcomes.push({ deliveryId: row.id, action: "expired", reason });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[expire-unfilled] broker step failed", { id: row.id, detail });
      outcomes.push({
        deliveryId: row.id,
        action: "kept",
        reason: `the broker could not be reached to clear this order (${detail})`,
      });
    }
  }

  return outcomes;
}
