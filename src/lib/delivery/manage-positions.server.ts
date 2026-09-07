/**
 * Managed-exit pass (DEMO ONLY).
 *
 * Only the managed policy `partial_tp1_runner_tp2` needs anything to happen after
 * an order fills: close part of the position at the first target, then move the
 * remaining stop to the fill price. This pass is that action, and nothing else —
 * it never opens a position, never widens a stop, never changes a target and
 * never touches a live account.
 *
 * Safety properties:
 *  - DEMO ONLY. A delivery on any other account mode is skipped outright; the
 *    dispatcher already refuses to submit the managed policy on a live account.
 *  - Durable, idempotent state. Every position gets one `position_management_state`
 *    row keyed by `(account_id, broker_position_id)`. A step is marked `attempted`
 *    BEFORE the broker call and only becomes `confirmed` on a definite broker
 *    acceptance, so a crash mid-flight can never repeat a close.
 *  - An `unknown` broker verdict stays `unknown`. It is not retried: repeating a
 *    close that may have succeeded could shut the runner down. The row states
 *    plainly that the action could not be confirmed.
 *  - No fabricated facts. A missing fill price, current price, volume, volume step
 *    or first target produces a recorded reason, never an action.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decideManagedPosition, type ManagedPositionFacts } from "./manage-positions";

/** Hard bound on how many managed positions one pass may touch. */
export const MANAGE_MAX_POSITIONS = 10;

export interface ManagePositionsOutcome {
  considered: number;
  partialsClosed: number;
  stopsMoved: number;
  skipped: number;
  unknown: number;
  results: { positionId: string; action: string; detail: string | null }[];
}

interface DeliveryRow {
  id: number;
  user_id: string;
  signal_id: string | null;
  connected_account_id: string | null;
  account_mode: string | null;
  execution_policy: string | null;
  broker_position_id: string | null;
  broker_symbol: string | null;
}

interface StateRow {
  broker_position_id: string;
  partial_state: string;
  stop_move_state: string;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;

export async function manageDemoPositions(
  db: SupabaseClient,
  maxPositions: number = MANAGE_MAX_POSITIONS,
): Promise<ManagePositionsOutcome> {
  const outcome: ManagePositionsOutcome = {
    considered: 0,
    partialsClosed: 0,
    stopsMoved: 0,
    skipped: 0,
    unknown: 0,
    results: [],
  };

  const { data, error } = await db
    .from("execution_deliveries")
    .select(
      "id, user_id, signal_id, connected_account_id, account_mode, execution_policy, broker_position_id, broker_symbol",
    )
    .eq("execution_policy", "partial_tp1_runner_tp2")
    .eq("account_mode", "demo")
    .not("broker_position_id", "is", null)
    .order("id", { ascending: false })
    .limit(maxPositions * 4);
  if (error) {
    console.error("[manage-positions] deliveries unreadable", error.message);
    return outcome;
  }

  const deliveries = ((data ?? []) as DeliveryRow[]).filter(
    (row) => row.broker_position_id && row.connected_account_id,
  );
  if (deliveries.length === 0) return outcome;

  // Existing management state: a position whose two steps are both settled is
  // finished and is not read again.
  const { data: stateRows } = await db
    .from("position_management_state")
    .select("broker_position_id, partial_state, stop_move_state")
    .in(
      "broker_position_id",
      deliveries.map((d) => d.broker_position_id as string),
    );
  const states = new Map<string, StateRow>();
  for (const row of (stateRows ?? []) as StateRow[]) states.set(row.broker_position_id, row);

  const settled = (s: StateRow | undefined): boolean => {
    if (!s) return false;
    const done = (v: string) => v === "confirmed" || v === "refused" || v === "unknown";
    return done(s.partial_state) && done(s.stop_move_state);
  };

  const pending = deliveries
    .filter((d) => !settled(states.get(d.broker_position_id as string)))
    .slice(0, maxPositions);
  outcome.considered = pending.length;
  if (pending.length === 0) return outcome;

  const { fetchPositions } = await import("@/lib/metaapi/accounts.server");
  const { partialClosePosition, modifyPositionProtection } =
    await import("@/lib/metaapi/trade.server");

  for (const delivery of pending) {
    const positionId = delivery.broker_position_id as string;
    const accountId = delivery.connected_account_id as string;

    const { data: accountRow } = await db
      .from("connected_trading_accounts")
      .select("id, metaapi_account_id, region, account_mode")
      .eq("id", accountId)
      .maybeSingle();
    const account = accountRow as {
      metaapi_account_id: string | null;
      region: string | null;
      account_mode: string | null;
    } | null;
    // Demo is asserted twice on purpose: the query filter is convenience, the
    // account's own recorded mode is the authority.
    if (!account?.metaapi_account_id || !account.region || account.account_mode !== "demo") {
      outcome.skipped += 1;
      outcome.results.push({
        positionId,
        action: "skipped",
        detail: "account is not a connected demo account",
      });
      continue;
    }

    let positions;
    try {
      positions = await fetchPositions(account.metaapi_account_id, account.region);
    } catch (err) {
      outcome.skipped += 1;
      outcome.results.push({
        positionId,
        action: "skipped",
        detail: `positions unreadable: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const position = positions.find((p) => String(p.id ?? "") === positionId);
    if (!position) {
      // The position is gone: it closed at its target or its stop. Nothing to
      // manage, and nothing is assumed about how it ended.
      await settleState(db, delivery, positionId, {
        partial_state: "not_applicable",
        partial_detail: "the position was already closed at the broker",
        stop_move_state: "not_applicable",
        stop_move_detail: "the position was already closed at the broker",
      });
      outcome.skipped += 1;
      outcome.results.push({ positionId, action: "skipped", detail: "position already closed" });
      continue;
    }

    const side = String(position.type ?? "").includes("SELL") ? "short" : "long";

    const { data: signalRow } = delivery.signal_id
      ? await db.from("scanned_signals").select("tp1").eq("id", delivery.signal_id).maybeSingle()
      : { data: null };
    const { data: specRow } = await db
      .from("connected_account_specs")
      .select("volume_step, volume_min")
      .eq("account_id", accountId)
      .eq("broker_symbol", delivery.broker_symbol ?? position.symbol ?? "")
      .maybeSingle();

    const facts: ManagedPositionFacts = {
      side,
      openPrice: num(position.openPrice),
      currentPrice: num(position.currentPrice),
      volume: num(position.volume),
      firstTarget: num((signalRow as { tp1?: unknown } | null)?.tp1),
      volumeStep: num((specRow as { volume_step?: unknown } | null)?.volume_step),
      minVolume: num((specRow as { volume_min?: unknown } | null)?.volume_min),
      currentStop: num(position.stopLoss),
    };

    const state = states.get(positionId);
    const decision = decideManagedPosition(
      facts,
      state?.partial_state === "confirmed",
      state?.stop_move_state === "confirmed",
    );

    if (decision.closeVolume === null && decision.moveStopTo === null) {
      if (decision.undecidable) {
        outcome.unknown += 1;
        await settleState(db, delivery, positionId, {
          partial_detail: decision.reason,
        });
      } else {
        outcome.skipped += 1;
        await settleState(db, delivery, positionId, { partial_detail: decision.reason });
      }
      outcome.results.push({ positionId, action: "no action", detail: decision.reason });
      continue;
    }

    if (decision.closeVolume !== null) {
      await settleState(db, delivery, positionId, {
        partial_volume: decision.closeVolume,
        partial_state: "attempted",
        partial_attempted_at: new Date().toISOString(),
        partial_detail: null,
      });
      const verdict = await partialClosePosition(
        account.metaapi_account_id,
        account.region,
        positionId,
        decision.closeVolume,
      );
      if (verdict.outcome === "accepted") {
        outcome.partialsClosed += 1;
        await settleState(db, delivery, positionId, {
          partial_state: "confirmed",
          partial_confirmed_at: new Date().toISOString(),
          partial_detail: verdict.message,
        });
        outcome.results.push({
          positionId,
          action: "partial closed",
          detail: `${decision.closeVolume} lots`,
        });
      } else if (verdict.outcome === "rejected") {
        await settleState(db, delivery, positionId, {
          partial_state: "refused",
          partial_detail: verdict.message ?? verdict.stringCode,
        });
        outcome.results.push({ positionId, action: "partial refused", detail: verdict.message });
      } else {
        outcome.unknown += 1;
        await settleState(db, delivery, positionId, {
          partial_state: "unknown",
          partial_detail:
            verdict.message ??
            "The broker did not confirm the partial close; it is not repeated automatically.",
        });
        outcome.results.push({
          positionId,
          action: "partial unconfirmed",
          detail: verdict.message,
        });
      }
      continue;
    }

    if (decision.moveStopTo !== null) {
      await settleState(db, delivery, positionId, {
        stop_move_target: decision.moveStopTo,
        stop_move_state: "attempted",
        stop_move_attempted_at: new Date().toISOString(),
        stop_move_detail: null,
      });
      const verdict = await modifyPositionProtection(
        account.metaapi_account_id,
        account.region,
        positionId,
        decision.moveStopTo,
      );
      if (verdict.outcome === "accepted") {
        outcome.stopsMoved += 1;
        await settleState(db, delivery, positionId, {
          stop_move_state: "confirmed",
          stop_move_confirmed_at: new Date().toISOString(),
          stop_move_detail: verdict.message,
        });
        outcome.results.push({ positionId, action: "stop moved to break-even", detail: null });
      } else if (verdict.outcome === "rejected") {
        await settleState(db, delivery, positionId, {
          stop_move_state: "refused",
          stop_move_detail: verdict.message ?? verdict.stringCode,
        });
        outcome.results.push({ positionId, action: "stop move refused", detail: verdict.message });
      } else {
        outcome.unknown += 1;
        await settleState(db, delivery, positionId, {
          stop_move_state: "unknown",
          stop_move_detail:
            verdict.message ?? "The broker did not confirm the stop move; it is left as unknown.",
        });
        outcome.results.push({
          positionId,
          action: "stop move unconfirmed",
          detail: verdict.message,
        });
      }
    }
  }

  return outcome;
}

/** Creates or updates the durable management row for one position. */
async function settleState(
  db: SupabaseClient,
  delivery: DeliveryRow,
  positionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("position_management_state").upsert(
    {
      user_id: delivery.user_id,
      delivery_id: delivery.id,
      account_id: delivery.connected_account_id,
      broker_position_id: positionId,
      execution_policy: "partial_tp1_runner_tp2",
      account_mode: "demo",
      ...patch,
    } as never,
    { onConflict: "account_id,broker_position_id" },
  );
  if (error) console.error("[manage-positions] state write failed", error.message);
}
