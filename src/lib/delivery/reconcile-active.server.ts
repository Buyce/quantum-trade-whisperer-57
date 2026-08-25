/**
 * Active-signal execution reconciliation.
 *
 * WHY this exists. Automatic orders used to be a one-shot, publish-time event:
 * `enqueueDirectDeliveries` was called exactly once, inline in the scanner
 * pipeline, immediately after a setup was published. If the owner armed an
 * account a minute later, reconnected a broker, fixed their instrument list,
 * raised their grade threshold, or if the worker was simply unavailable in that
 * one instant, the setup stayed active and valid forever with no order and no
 * second attempt. This reconciler is that second attempt, and every later one.
 *
 * WHAT it is not. It is not a second rule set. It re-runs the SAME authoritative
 * gate stack (`enqueueDirectDeliveries`: lifecycle, global execution controls,
 * armed accounts, owner rules, C-Grade opt-in, daily cap, intelligence gate,
 * concurrent-order ceiling) and leaves the SAME decision trail. Pre-send
 * revalidation in the dispatcher — quote freshness, maximum acceptable entry,
 * spread, geometry, sizing, margin, exposure, account mode — remains the final
 * authority; nothing here bypasses it.
 *
 * Alerts are irrelevant to it. It reconciles execution from authoritative signal
 * state only: it never reads alert rows, never recreates an alert, a failed alert
 * never blocks an order, and a delivered alert never authorizes one.
 *
 * Idempotency and concurrency come from the database: deliveries are upserted on
 * `(user_id, signal_id, bridge_profile)` with duplicates ignored, so two workers
 * running the same pass cannot create a duplicate order.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { GRADE_RANK, type Grade } from "@/lib/db-types";
import {
  enqueueDirectDeliveries,
  executionWindowExpired,
  type DirectEnqueueSignal,
} from "./direct-enqueue.server";

/** Hard bound on how many active signals one pass may consider. */
export const RECONCILE_MAX_SIGNALS = 25;

export interface ActiveSignalRow {
  id: string;
  instrument: string;
  grade: string;
  direction: string | null;
  detected_at: string;
  expired_at: string | null;
  status: string;
}

export interface ReconcileOutcome {
  considered: number;
  attempted: number;
  enqueued: number;
  filtered: number;
  results: { signalId: string; instrument: string; enqueued: number; reason: string | null }[];
}

/**
 * Deterministic ranking — the SAME ordering the signal feed and the automatic
 * order path already imply, not a new one:
 *
 *   1. grade (A+ > A > B > C), the feed's primary quality ordering
 *   2. detection time, newest first, exactly as the feed lists setups
 *   3. id, as a stable tie-breaker so two workers rank identically
 *
 * This ordering decides WHICH eligible signals are considered first when more
 * qualify than the owner's ceiling allows. It is a selection order, never a
 * quality claim and never a win probability.
 */
export function rankActiveSignals<T extends ActiveSignalRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ga = GRADE_RANK[a.grade as Grade] ?? 0;
    const gb = GRADE_RANK[b.grade as Grade] ?? 0;
    if (ga !== gb) return gb - ga;
    const ta = new Date(a.detected_at).getTime();
    const tb = new Date(b.detected_at).getTime();
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Still entryable at `nowMs`: active status, not expired, not superseded. */
export function isReconcilable(row: ActiveSignalRow, nowMs: number): boolean {
  if (row.status !== "active") return false;
  if (row.expired_at !== null && new Date(row.expired_at).getTime() <= nowMs) return false;
  if (executionWindowExpired({ detectedAt: row.detected_at }, nowMs)) return false;
  return true;
}

/**
 * One bounded reconciliation pass.
 *
 * Every signal it considers goes through the authoritative enqueue path, which
 * records a decision for each armed owner — including every refusal — so an
 * unqueued active setup is always explained rather than silently skipped.
 */
export async function reconcileActiveSignals(
  db: SupabaseClient,
  nowMs: number = Date.now(),
  maxSignals: number = RECONCILE_MAX_SIGNALS,
): Promise<ReconcileOutcome> {
  const outcome: ReconcileOutcome = {
    considered: 0,
    attempted: 0,
    enqueued: 0,
    filtered: 0,
    results: [],
  };

  const { data, error } = await db
    .from("scanned_signals")
    .select("id, instrument, grade, direction, detected_at, expired_at, status")
    .eq("status", "active")
    .order("detected_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[reconcile-active] signals unreadable", error.message);
    return outcome;
  }

  const candidates = rankActiveSignals(
    ((data ?? []) as ActiveSignalRow[]).filter((row) => isReconcilable(row, nowMs)),
  ).slice(0, maxSignals);
  outcome.considered = candidates.length;

  // Session for the cap/eligibility frame comes from the same market context the
  // publish-time path uses; when it is unreadable the eligibility rules treat the
  // session as unknown and never suppress on it.
  const sessions = new Map<string, string | null>();
  if (candidates.length) {
    const { data: contextRows } = await db
      .from("market_context")
      .select("signal_id, trading_session")
      .in(
        "signal_id",
        candidates.map((c) => c.id),
      );
    for (const row of (contextRows ?? []) as {
      signal_id: string;
      trading_session: string | null;
    }[]) {
      sessions.set(row.signal_id, row.trading_session);
    }
  }

  for (const signal of candidates) {
    const payload: DirectEnqueueSignal = {
      id: signal.id,
      instrument: signal.instrument,
      grade: signal.grade,
      session: sessions.get(signal.id) ?? "",
      detectedAt: signal.detected_at,
      ...(signal.direction ? { direction: signal.direction } : {}),
    };
    const result = await enqueueDirectDeliveries(db, payload, nowMs);
    outcome.attempted += 1;
    outcome.enqueued += result.enqueued;
    outcome.filtered += result.filtered;
    outcome.results.push({
      signalId: signal.id,
      instrument: signal.instrument,
      enqueued: result.enqueued,
      reason: result.reason,
    });
  }

  return outcome;
}
