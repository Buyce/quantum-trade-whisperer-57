/**
 * Managed-exit pass (DEMO ONLY).
 *
 * Two policies need something to happen after an order fills:
 *  - `partial_tp1_runner_tp2` — part out at the first target, then move the
 *    remaining stop to the fill price.
 *  - `ladder_tp1_tp2_runner_tp3` — the same, then part out at the second target,
 *    then lift the remaining stop to the first target, with an optional trail on
 *    the final runner.
 *
 * This pass performs those steps and nothing else — it never opens a position,
 * never widens a stop, never changes a target and never touches a live account.
 *
 * Safety properties:
 *  - DEMO ONLY. A delivery on any other account mode is skipped outright; the
 *    dispatcher already refuses to submit a managed policy on a live account.
 *  - Durable, idempotent state. Every position gets one `position_management_state`
 *    row keyed by `(account_id, broker_position_id)`. A step is marked `attempted`
 *    BEFORE the broker call and only becomes `confirmed` on a definite broker
 *    acceptance, so a crash mid-flight can never repeat a close.
 *  - An `unknown` broker verdict stays `unknown`. It is not retried: repeating a
 *    close that may have succeeded could shut the runner down. The row states
 *    plainly that the action could not be confirmed.
 *  - No fabricated facts. A missing fill price, current price, volume, volume step
 *    or target produces a recorded reason, never an action.
 *  - One step per position per pass, in order.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_EXIT_SHARE_PRESET,
  DEMO_ACCOUNT_MODES,
  isDemoAccountMode,
  isExitSharePreset,
  type ExitSharePreset,
} from "./execution";
import {
  decideManagedStep,
  managedPlan,
  type ManagedPositionFacts,
  type ManagedStep,
} from "./manage-positions";

/** Hard bound on how many managed positions one pass may touch. */
export const MANAGE_MAX_POSITIONS = 10;

const MANAGED_POLICIES = ["partial_tp1_runner_tp2", "ladder_tp1_tp2_runner_tp3"];

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
  second_partial_state: string;
  runner_stop_state: string;
  best_price: number | string | null;
  partial_volume: number | string | null;
  trail_moves: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;

/** Column prefixes for each step's durable record. */
const STEP_FIELDS: Record<ManagedStep, { state: string; detail: string; value: string }> = {
  partial_1: { state: "partial_state", detail: "partial_detail", value: "partial_volume" },
  stop_to_entry: {
    state: "stop_move_state",
    detail: "stop_move_detail",
    value: "stop_move_target",
  },
  partial_2: {
    state: "second_partial_state",
    detail: "second_partial_detail",
    value: "second_partial_volume",
  },
  stop_to_first_target: {
    state: "runner_stop_state",
    detail: "runner_stop_detail",
    value: "runner_stop_target",
  },
  trail: { state: "runner_stop_state", detail: "trail_detail", value: "trail_stop_target" },
};

const STEP_LABELS: Record<ManagedStep, string> = {
  partial_1: "part closed at the first target",
  stop_to_entry: "stop moved to break-even",
  partial_2: "part closed at the second target",
  stop_to_first_target: "stop lifted to the first target",
  trail: "trailing stop moved",
};

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
    .in("execution_policy", MANAGED_POLICIES)
    // Demo money is recorded as the account's ARMED mode (`demo_auto`), so both
    // spellings are accepted; nothing outside demo money is ever selected.
    .in("account_mode", DEMO_ACCOUNT_MODES as unknown as string[])
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

  // Existing management state: a position whose steps are all settled is finished
  // and is not read again.
  const { data: stateRows } = await db
    .from("position_management_state")
    .select(
      "broker_position_id, partial_state, stop_move_state, second_partial_state, runner_stop_state, best_price, partial_volume, trail_moves",
    )
    .in(
      "broker_position_id",
      deliveries.map((d) => d.broker_position_id as string),
    );
  const states = new Map<string, StateRow>();
  for (const row of (stateRows ?? []) as StateRow[]) states.set(row.broker_position_id, row);

  const done = (v: string | null | undefined) =>
    v === "confirmed" || v === "refused" || v === "unknown" || v === "not_applicable";

  const settled = (delivery: DeliveryRow, s: StateRow | undefined): boolean => {
    if (!s) return false;
    if (!done(s.partial_state) || !done(s.stop_move_state)) return false;
    if (delivery.execution_policy !== "ladder_tp1_tp2_runner_tp3") return true;
    // A laddered position stays open for management while a later step can still
    // act; a refused or unknown verdict settles that step for good.
    return (
      s.partial_state !== "confirmed" || (done(s.second_partial_state) && done(s.runner_stop_state))
    );
  };

  const pending = deliveries.filter((d) => !settled(d, states.get(d.broker_position_id as string)));
  outcome.considered = Math.min(pending.length, maxPositions);
  if (pending.length === 0) return outcome;

  const { fetchPositions } = await import("@/lib/metaapi/accounts.server");
  const { partialClosePosition, modifyPositionProtection } =
    await import("@/lib/metaapi/trade.server");

  for (const delivery of pending.slice(0, maxPositions)) {
    const positionId = delivery.broker_position_id as string;
    const accountId = delivery.connected_account_id as string;
    const policy = delivery.execution_policy ?? "partial_tp1_runner_tp2";

    const { data: accountRow } = await db
      .from("connected_trading_accounts")
      .select("id, metaapi_account_id, region, mode, broker_account_type")
      .eq("id", accountId)
      .maybeSingle();
    const account = accountRow as {
      metaapi_account_id: string | null;
      region: string | null;
      mode: string | null;
      broker_account_type: string | null;
    } | null;
    // Demo is asserted twice on purpose: the delivery filter is convenience, the
    // account's own broker-reported type and armed mode are the authority.
    if (
      !account?.metaapi_account_id ||
      !account.region ||
      account.broker_account_type !== "demo" ||
      !isDemoAccountMode(account.mode)
    ) {
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
      // The position is gone: it closed at a target or its stop. Nothing to
      // manage, and nothing is assumed about how it ended.
      await settleState(db, delivery, positionId, {
        partial_state: "not_applicable",
        partial_detail: "the position was already closed at the broker",
        stop_move_state: "not_applicable",
        stop_move_detail: "the position was already closed at the broker",
        second_partial_state: "not_applicable",
        runner_stop_state: "not_applicable",
      });
      outcome.skipped += 1;
      outcome.results.push({ positionId, action: "skipped", detail: "position already closed" });
      continue;
    }

    const side = String(position.type ?? "").includes("SELL") ? "short" : "long";

    const { data: signalRow } = delivery.signal_id
      ? await db
          .from("scanned_signals")
          .select("tp1, tp2, entry_price, stop_loss")
          .eq("id", delivery.signal_id)
          .maybeSingle()
      : { data: null };
    const signal = signalRow as {
      tp1?: unknown;
      tp2?: unknown;
      entry_price?: unknown;
      stop_loss?: unknown;
    } | null;
    const { data: specRow } = await db
      .from("connected_account_specs")
      .select("volume_step, volume_min")
      .eq("account_id", accountId)
      .eq("broker_symbol", delivery.broker_symbol ?? position.symbol ?? "")
      .maybeSingle();
    const { data: settingsRow } = await db
      .from("scanner_settings")
      .select("auto_exit_shares, auto_exit_trail_runner")
      .eq("user_id", delivery.user_id)
      .maybeSingle();
    const settings = settingsRow as {
      auto_exit_shares?: unknown;
      auto_exit_trail_runner?: unknown;
    } | null;
    const preset: ExitSharePreset = isExitSharePreset(settings?.auto_exit_shares)
      ? settings.auto_exit_shares
      : DEFAULT_EXIT_SHARE_PRESET;

    const state = states.get(positionId);
    const currentPrice = num(position.currentPrice);
    const entry = num(signal?.entry_price);
    const planStop = num(signal?.stop_loss);
    const bestSoFar = num(state?.best_price ?? null);
    // Shares are fractions of the ORIGINAL fill. Once a part has been closed the
    // broker reports only the remainder, so the confirmed part is added back.
    const openVolume = num(position.volume);
    const closedSoFar = state?.partial_state === "confirmed" ? (num(state.partial_volume) ?? 0) : 0;
    const originalVolume =
      openVolume === null ? null : Number((openVolume + closedSoFar).toFixed(8));
    const bestPrice =
      currentPrice === null
        ? bestSoFar
        : bestSoFar === null
          ? currentPrice
          : side === "long"
            ? Math.max(bestSoFar, currentPrice)
            : Math.min(bestSoFar, currentPrice);

    const facts: ManagedPositionFacts = {
      side,
      openPrice: num(position.openPrice),
      currentPrice,
      volume: num(position.volume),
      originalVolume: originalVolume,
      firstTarget: num(signal?.tp1),
      secondTarget: num(signal?.tp2),
      riskDistance: entry !== null && planStop !== null ? Math.abs(entry - planStop) : null,
      bestPrice,
      volumeStep: num((specRow as { volume_step?: unknown } | null)?.volume_step),
      minVolume: num((specRow as { volume_min?: unknown } | null)?.volume_min),
      currentStop: num(position.stopLoss),
    };

    const plan = {
      ...managedPlan(policy, preset),
      trailRunner: settings?.auto_exit_trail_runner === true,
    };
    const decision = decideManagedStep(
      facts,
      {
        partialDone: state?.partial_state === "confirmed",
        stopMoved: state?.stop_move_state === "confirmed",
        secondPartialDone: state?.second_partial_state === "confirmed",
        runnerStopMoved: state?.runner_stop_state === "confirmed",
      },
      plan,
    );

    if (decision.step === null) {
      if (decision.undecidable) outcome.unknown += 1;
      else outcome.skipped += 1;
      await settleState(db, delivery, positionId, {
        best_price: bestPrice,
        partial_detail: decision.reason,
      });
      outcome.results.push({ positionId, action: "no action", detail: decision.reason });
      continue;
    }

    const fields = STEP_FIELDS[decision.step];
    const now = new Date().toISOString();
    const attemptPatch: Record<string, unknown> = {
      best_price: bestPrice,
      [fields.state]: "attempted",
      [fields.detail]: null,
      [fields.value]: decision.closeVolume ?? decision.moveStopTo,
    };
    if (decision.step === "partial_1") attemptPatch["partial_attempted_at"] = now;
    if (decision.step === "stop_to_entry") attemptPatch["stop_move_attempted_at"] = now;
    if (decision.step === "partial_2") attemptPatch["second_partial_attempted_at"] = now;
    if (decision.step === "stop_to_first_target") attemptPatch["runner_stop_attempted_at"] = now;
    // A trail move reuses the runner-stop step; it is allowed to repeat, so it is
    // recorded as a count rather than a one-shot state.
    if (decision.step === "trail") delete attemptPatch[fields.state];
    await settleState(db, delivery, positionId, attemptPatch);

    const verdict =
      decision.closeVolume !== null
        ? await partialClosePosition(
            account.metaapi_account_id,
            account.region,
            positionId,
            decision.closeVolume,
          )
        : await modifyPositionProtection(
            account.metaapi_account_id,
            account.region,
            positionId,
            decision.moveStopTo as number,
          );

    const label = STEP_LABELS[decision.step];
    if (verdict.outcome === "accepted") {
      if (decision.closeVolume !== null) outcome.partialsClosed += 1;
      else outcome.stopsMoved += 1;
      const patch: Record<string, unknown> = { [fields.detail]: verdict.message };
      if (decision.step === "trail") {
        patch["trail_moves"] = (state?.trail_moves ?? 0) + 1;
      } else {
        patch[fields.state] = "confirmed";
        if (decision.step === "partial_1") patch["partial_confirmed_at"] = now;
        if (decision.step === "stop_to_entry") patch["stop_move_confirmed_at"] = now;
        if (decision.step === "partial_2") patch["second_partial_confirmed_at"] = now;
        if (decision.step === "stop_to_first_target") patch["runner_stop_confirmed_at"] = now;
      }
      await settleState(db, delivery, positionId, patch);
      outcome.results.push({
        positionId,
        action: label,
        detail: decision.closeVolume !== null ? `${decision.closeVolume} lots` : null,
      });
    } else if (verdict.outcome === "rejected") {
      await settleState(db, delivery, positionId, {
        ...(decision.step === "trail" ? {} : { [fields.state]: "refused" }),
        [fields.detail]: verdict.message ?? verdict.stringCode,
      });
      outcome.results.push({ positionId, action: `${label} refused`, detail: verdict.message });
    } else {
      outcome.unknown += 1;
      await settleState(db, delivery, positionId, {
        ...(decision.step === "trail" ? {} : { [fields.state]: "unknown" }),
        [fields.detail]:
          verdict.message ??
          "The broker did not confirm this step; it is not repeated automatically.",
      });
      outcome.results.push({
        positionId,
        action: `${label} unconfirmed`,
        detail: verdict.message,
      });
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
      execution_policy: delivery.execution_policy ?? "partial_tp1_runner_tp2",
      account_mode: "demo",
      ...patch,
    } as never,
    { onConflict: "account_id,broker_position_id" },
  );
  if (error) console.error("[manage-positions] state write failed", error.message);
}
