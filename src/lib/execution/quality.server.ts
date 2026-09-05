/**
 * Execution-quality scoring and automatic cooldowns — the evidence reader.
 *
 * Reads only recorded fact:
 *  - closed `broker_trade_evidence` rows for slippage the broker actually gave
 *    and realised R;
 *  - `execution_deliveries` rows for what the broker refused and why.
 *
 * A (account, instrument, session) dimension is scored against ITS OWN earlier
 * window. Nothing is compared to another instrument, another account or a
 * hardcoded constant, and a dimension with too little recorded fact stays
 * "not measured" — it never earns a score and never triggers a cooldown.
 *
 * Recompute runs on a bounded cron pass, never on a request path. The gate that
 * reads the result (`activeCooldown`) only ever reads already-computed rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NORM_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  evaluateCooldown,
  scoreWindow,
  splitWindows,
  type ClosedExecution,
  type CooldownVerdict,
  type DeliveryOutcome,
} from "./quality";

/** Bounded: this is a scheduled pass, not an unbounded history walk. */
const MAX_EVIDENCE_ROWS = 4000;
const MAX_DELIVERY_ROWS = 4000;

/** Session is part of the dimension. An unrecorded session is its own bucket. */
const UNKNOWN_SESSION = "unknown";

export interface DimensionKey {
  accountId: string;
  instrument: string;
  session: string;
}

const keyOf = (k: DimensionKey) => `${k.accountId}|${k.instrument}|${k.session}`;

interface Bucket {
  key: DimensionKey;
  closed: (ClosedExecution & { atMs: number })[];
  deliveries: (DeliveryOutcome & { atMs: number })[];
}

export interface RecomputeResult {
  dimensions: number;
  scoresWritten: number;
  cooldownsOpened: number;
  cooldownsLifted: number;
  skipped: string[];
}

/**
 * Recompute every dimension's score and open or lift cooldowns accordingly.
 *
 * Cooldowns are never extended silently: an open cooldown whose resume time has
 * passed is lifted, and only a fresh breach opens a new one. That way a
 * dimension always gets re-tested live rather than being condemned forever by
 * one bad fortnight.
 */
export async function recomputeExecutionQuality(
  db: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<RecomputeResult> {
  const skipped: string[] = [];
  const since = new Date(nowMs - NORM_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [evidence, deliveries] = await Promise.all([
    db
      .from("broker_trade_evidence")
      .select(
        "account_id, signal_instrument, signal_trading_session, exit_at, slippage_price, slippage_availability, r_vs_plan, r_availability",
      )
      .eq("state", "closed")
      .not("account_id", "is", null)
      .not("exit_at", "is", null)
      .gte("exit_at", since)
      .order("exit_at", { ascending: false })
      .limit(MAX_EVIDENCE_ROWS),
    db
      .from("execution_deliveries")
      .select(
        "connected_account_id, state, reason, enqueued_at, scanned_signals(instrument, market_context(trading_session))",
      )
      .not("connected_account_id", "is", null)
      .gte("enqueued_at", since)
      .order("enqueued_at", { ascending: false })
      .limit(MAX_DELIVERY_ROWS),
  ]);

  // An unreadable side is NOT an empty side. Scoring on half the evidence would
  // produce a number that looks measured and is not, so the pass stops instead.
  if (evidence.error) {
    return {
      dimensions: 0,
      scoresWritten: 0,
      cooldownsOpened: 0,
      cooldownsLifted: 0,
      skipped: [`closed broker evidence unreadable: ${evidence.error.message}`],
    };
  }
  if (deliveries.error) {
    return {
      dimensions: 0,
      scoresWritten: 0,
      cooldownsOpened: 0,
      cooldownsLifted: 0,
      skipped: [`delivery ledger unreadable: ${deliveries.error.message}`],
    };
  }

  const buckets = new Map<string, Bucket>();
  const bucketFor = (key: DimensionKey): Bucket => {
    const id = keyOf(key);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { key, closed: [], deliveries: [] };
      buckets.set(id, bucket);
    }
    return bucket;
  };

  for (const row of (evidence.data ?? []) as {
    account_id: string | null;
    signal_instrument: string | null;
    signal_trading_session: string | null;
    exit_at: string;
    slippage_price: number | null;
    slippage_availability: string | null;
    r_vs_plan: number | null;
    r_availability: string | null;
  }[]) {
    if (!row.account_id || !row.signal_instrument) continue;
    const atMs = Date.parse(row.exit_at);
    if (!Number.isFinite(atMs)) continue;
    // Slippage and R are only used when the evidence itself declares them
    // available. An "unavailable" figure is not a zero.
    bucketFor({
      accountId: row.account_id,
      instrument: row.signal_instrument,
      session: row.signal_trading_session ?? UNKNOWN_SESSION,
    }).closed.push({
      atMs,
      exitAtMs: atMs,
      slippagePrice: row.slippage_availability === "available" ? row.slippage_price : null,
      rVsPlan: row.r_availability === "available" ? row.r_vs_plan : null,
    });
  }

  let deliveriesWithoutSignal = 0;
  for (const row of (deliveries.data ?? []) as {
    connected_account_id: string | null;
    state: string;
    reason: string | null;
    enqueued_at: string;
    scanned_signals: {
      instrument: string | null;
      market_context: { trading_session: string | null } | { trading_session: string | null }[] | null;
    } | null;
  }[]) {
    if (!row.connected_account_id) continue;
    const instrument = row.scanned_signals?.instrument ?? null;
    // The signal behind a purged delivery cannot be placed on a dimension. It is
    // dropped from the sample rather than guessed into one.
    if (!instrument) {
      deliveriesWithoutSignal += 1;
      continue;
    }
    const atMs = Date.parse(row.enqueued_at);
    if (!Number.isFinite(atMs)) continue;
    const context = row.scanned_signals?.market_context ?? null;
    const session =
      (Array.isArray(context) ? context[0]?.trading_session : context?.trading_session) ??
      UNKNOWN_SESSION;
    bucketFor({ accountId: row.connected_account_id, instrument, session }).deliveries.push({
      atMs,
      enqueuedAtMs: atMs,
      state: row.state,
      rejectReason: row.reason,
    });
  }
  if (deliveriesWithoutSignal > 0) {
    skipped.push(
      `${deliveriesWithoutSignal} deliveries excluded: the signal behind them is no longer stored, so no instrument or session could be read`,
    );
  }

  const scoreRows: Record<string, unknown>[] = [];
  const breaches: { key: DimensionKey; verdict: CooldownVerdict }[] = [];

  for (const bucket of buckets.values()) {
    const closedSplit = splitWindows(bucket.closed, nowMs);
    const deliverySplit = splitWindows(bucket.deliveries, nowMs);

    const recent = scoreWindow(
      { closed: closedSplit.recent, deliveries: deliverySplit.recent },
      RECENT_WINDOW_DAYS,
    );
    const norm = scoreWindow(
      { closed: closedSplit.norm, deliveries: deliverySplit.norm },
      NORM_WINDOW_DAYS - RECENT_WINDOW_DAYS,
    );

    const verdict = evaluateCooldown(recent, norm, nowMs);
    if (verdict.breached) breaches.push({ key: bucket.key, verdict });

    scoreRows.push({
      account_id: bucket.key.accountId,
      instrument: bucket.key.instrument,
      session: bucket.key.session,
      computed_at: new Date(nowMs).toISOString(),
      recent_window_days: RECENT_WINDOW_DAYS,
      closed_sample: recent.closedSample,
      slippage_sample: recent.slippageSample,
      median_slippage: recent.medianSlippage,
      p90_slippage: recent.p90Slippage,
      r_sample: recent.rSample,
      avg_r: recent.avgR,
      delivery_sample: recent.deliverySample,
      rejected_count: recent.rejectedCount,
      reject_rate: recent.rejectRate,
      margin_refusals: recent.marginRefusals,
      median_order_to_fill_seconds: null,
      norm_closed_sample: norm.closedSample,
      norm_median_slippage: norm.medianSlippage,
      norm_reject_rate: norm.rejectRate,
      measured: recent.measured,
      unmeasured_reason: recent.unmeasuredReason,
    });
  }

  if (scoreRows.length > 0) {
    const { error } = await db
      .from("execution_quality_scores")
      .upsert(scoreRows, { onConflict: "account_id,instrument,session" });
    if (error) skipped.push(`scores not persisted: ${error.message}`);
  }

  // Lift expired cooldowns first, so a fresh breach on the same dimension opens
  // a new, separately auditable window rather than silently extending an old one.
  const nowIso = new Date(nowMs).toISOString();
  const lifted = await db
    .from("execution_cooldowns")
    .update({ lifted_at: nowIso })
    .is("lifted_at", null)
    .lte("resume_after", nowIso)
    .select("id");
  if (lifted.error) skipped.push(`expired cooldowns not lifted: ${lifted.error.message}`);

  let cooldownsOpened = 0;
  if (breaches.length > 0) {
    const open = await db
      .from("execution_cooldowns")
      .select("account_id, instrument, session")
      .is("lifted_at", null);
    if (open.error) {
      skipped.push(`open cooldowns unreadable, none opened: ${open.error.message}`);
    } else {
      const alreadyOpen = new Set(
        ((open.data ?? []) as DimensionKeyRow[]).map((r) =>
          keyOf({ accountId: r.account_id, instrument: r.instrument, session: r.session }),
        ),
      );
      const inserts = breaches
        .filter(({ key }) => !alreadyOpen.has(keyOf(key)))
        .map(({ key, verdict }) => ({
          account_id: key.accountId,
          instrument: key.instrument,
          session: key.session,
          reason: verdict.reason as string,
          detail: verdict.detail as string,
          observed_value: verdict.observed,
          norm_value: verdict.norm,
          started_at: nowIso,
          resume_after: new Date(verdict.resumeAfterMs as number).toISOString(),
        }));
      if (inserts.length > 0) {
        const { error } = await db.from("execution_cooldowns").insert(inserts);
        if (error) skipped.push(`cooldowns not opened: ${error.message}`);
        else cooldownsOpened = inserts.length;
      }
    }
  }

  return {
    dimensions: buckets.size,
    scoresWritten: scoreRows.length,
    cooldownsOpened,
    cooldownsLifted: (lifted.data ?? []).length,
    skipped,
  };
}

interface DimensionKeyRow {
  account_id: string;
  instrument: string;
  session: string;
}

export interface ActiveCooldown {
  reason: string;
  detail: string;
  resumeAfter: string;
}

/**
 * Is this dimension currently cooling down?
 *
 * Read-only and cheap: it never computes a score, so an execution path can ask
 * it without paying for the aggregation. A read failure returns `null` — the
 * cooldown is an ADDITIONAL refusal on top of every existing gate, so an
 * unreadable cooldown table must not by itself block a trade the rest of the
 * stack already approved.
 */
export async function activeCooldown(
  db: SupabaseClient,
  key: DimensionKey,
  nowMs: number = Date.now(),
): Promise<ActiveCooldown | null> {
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await db
    .from("execution_cooldowns")
    .select("reason, detail, resume_after")
    .eq("account_id", key.accountId)
    .eq("instrument", key.instrument)
    .eq("session", key.session)
    .is("lifted_at", null)
    .gt("resume_after", nowIso)
    .order("resume_after", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("execution cooldown unreadable", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as { reason: string; detail: string; resume_after: string };
  return { reason: row.reason, detail: row.detail, resumeAfter: row.resume_after };
}

export { UNKNOWN_SESSION };
