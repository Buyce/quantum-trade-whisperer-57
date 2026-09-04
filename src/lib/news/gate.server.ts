/**
 * News gate at the execution boundaries.
 *
 * This is the ONLY place where the pure news policy is read from the database and
 * applied to an automatic order. Two questions stay separate, exactly as the
 * policy module defines them:
 *
 *   1. WOULD this instrument be suppressed right now?  — always computed, always recorded.
 *   2. IS that suppression enforced against this order? — only under the rules below.
 *
 * Enforcement rule (deliberately narrow):
 *   An order is refused only when the owner opted in (`news_block_new_entries`)
 *   AND the verdict names at least one concrete blocking event from the calendar
 *   we actually hold. A verdict that rests only on INCOMPLETE COVERAGE is
 *   recorded in comparison mode and NOT enforced, because an unproven feed would
 *   otherwise silently stop every automatic order — that would be a claim about
 *   the market made out of missing data. Coverage-only verdicts become
 *   enforceable when coverage is proven healthy for the instrument's scopes.
 *
 * Nothing here fabricates an event, a time or a coverage state: an unreadable
 * table yields a recorded "coverage unknown" verdict and no refusal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CoverageState } from "./coverage";
import { coverageClears, worstCoverage } from "./coverage";
import { requiredCoverageFor } from "./identity";
import {
  evaluateNewsPolicy,
  NEWS_POLICY_VERSION,
  type NewsPolicyVerdict,
  type PolicyEvent,
} from "./policy";
import type { EventImportance, NewsFamily, TimestampPrecision } from "./types";

export const NEWS_GATE_VERSION = "news-gate-1";

/** Where the gate was consulted. Mirrors `news_policy_evaluations.boundary`. */
export type NewsBoundary = "execution_enqueue" | "broker_submission";

/** Owner-configured news controls, as stored on `scanner_settings`. */
export interface NewsGateSettings {
  news_block_new_entries?: boolean | null;
  news_suppression_minutes_before?: number | null;
  news_suppression_minutes_after?: number | null;
}

export interface NewsGateResult {
  verdict: NewsPolicyVerdict;
  /** True only when this order must be refused on news grounds. */
  blocked: boolean;
  /** Plain-language detail for the decision ledger. Never a forecast. */
  detail: string;
}

/** The DB CHECK vocabulary is wider than the policy's; map it, never guess. */
function toCoverageState(stored: string): CoverageState {
  switch (stored) {
    case "healthy":
      return "healthy";
    case "partial":
    case "schedule_incomplete":
      return "partial";
    case "timestamp_incomplete":
      return "timestamp_incomplete";
    case "stale":
      return "stale";
    case "unsupported":
      return "unsupported";
    case "provider_error":
    case "authorization_error":
      return "provider_error";
    default:
      return "unproven";
  }
}

function clampMinutes(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.round(value), 720);
}

interface CoverageRow {
  currency: string | null;
  event_family: string;
  coverage_state: string;
  computed_at: string;
}

interface EventRow {
  id: string;
  canonical_event_id: string;
  event_family: string;
  currencies: string[] | null;
  affected_instruments: string[] | null;
  importance: string;
  scheduled_at: string | null;
  scheduled_date: string | null;
  timestamp_precision: string;
  event_status: string;
}


/**
 * Read helper that never throws into the execution path.
 *
 * A news table we cannot read yields NO events and NO coverage. That is safe by
 * construction here: enforcement additionally requires a named calendar event, so
 * an unreadable feed can never invent a refusal, and coverage stays "unproven"
 * rather than being reported as healthy.
 */
async function safeQuery<T>(run: () => PromiseLike<{ data: T[] | null }>): Promise<{ data: T[] | null }> {
  try {
    return await run();
  } catch (err) {
    console.error("[news-gate] read failed:", err instanceof Error ? err.message : String(err));
    return { data: null };
  }
}

/**
 * Evaluate the news gate for one instrument and record the evaluation.
 *
 * The record is best-effort: a diagnostic write must never decide whether an
 * order happens. The verdict itself is returned regardless.
 */
export async function evaluateNewsGate(
  db: SupabaseClient,
  args: {
    symbol: string;
    nowMs: number;
    boundary: NewsBoundary;
    settings: NewsGateSettings | null | undefined;
    signalId?: string | null;
    deliveryId?: number | null;
  },
): Promise<NewsGateResult> {
  const optedIn = args.settings?.news_block_new_entries !== false;
  const before = clampMinutes(args.settings?.news_suppression_minutes_before, 60);
  const after = clampMinutes(args.settings?.news_suppression_minutes_after, 30);
  const { currencies, families } = requiredCoverageFor(args.symbol);

  // ---- Coverage: the newest snapshot per (currency, family) ---------------
  const coverage = new Map<string, CoverageState>();
  if (families.length > 0) {
    const { data } = await safeQuery(() =>
      db
        .from("news_coverage_snapshots")
        .select("currency, event_family, coverage_state, computed_at")
      .in("event_family", families)
        .order("computed_at", { ascending: false })
        .limit(500),
    );
    for (const row of ((data ?? []) as CoverageRow[])) {
      const key = `${(row.currency ?? "").toUpperCase()}|${row.event_family}`;
      // Ordered newest-first, so the first sighting of a scope is the current one.
      if (!coverage.has(key)) coverage.set(key, toCoverageState(row.coverage_state));
    }
  }

  // ---- Events: only what could plausibly bear on NOW ----------------------
  const events: PolicyEvent[] = [];
  if (families.length > 0) {
    const windowMs = Math.max(before, after, 60) * 60_000 + 6 * 60 * 60_000;
    const today = new Date(args.nowMs).toISOString().slice(0, 10);
    const { data } = await safeQuery(() =>
      db
        .from("economic_events")
        .select(
          "id, canonical_event_id, event_family, currencies, affected_instruments, importance, scheduled_at, scheduled_date, timestamp_precision, event_status",
        )
        .in("event_family", families)
        .or(
          `and(scheduled_at.gte.${new Date(args.nowMs - windowMs).toISOString()},scheduled_at.lte.${new Date(args.nowMs + windowMs).toISOString()}),scheduled_date.eq.${today}`,
        )
        .limit(500),
    );
    for (const row of ((data ?? []) as EventRow[])) {
      events.push({
        canonicalEventId: row.canonical_event_id,
        family: row.event_family as NewsFamily,
        currencies: row.currencies ?? [],
        importance: row.importance as EventImportance,
        scheduledAt: row.scheduled_at,
        scheduledDate: row.scheduled_date,
        timestampPrecision: row.timestamp_precision as TimestampPrecision,
        status: row.event_status,
        ...(row.affected_instruments ? { affectedInstruments: row.affected_instruments } : {}),
      });
    }
  }

  const requiredStates = currencies.flatMap((currency) =>
    families.map(
      (family) => coverage.get(`${currency.toUpperCase()}|${family}`) ?? ("unproven" as CoverageState),
    ),
  );
  const coverageProven = requiredStates.length > 0 && coverageClears(worstCoverage(requiredStates));

  const verdict = evaluateNewsPolicy({
    symbol: args.symbol,
    nowMs: args.nowMs,
    // Comparison unless the owner opted in; enforcement is narrowed again below.
    mode: optedIn ? "enforcing" : "dark",
    events,
    coverage,
    windowOverride: { beforeMinutes: before, afterMinutes: after },
  });

  const namesAnEvent = verdict.blockingEventIds.length > 0;
  const enforceable = verdict.reason === "event_window" ? namesAnEvent : coverageProven && namesAnEvent;
  const blocked = optedIn && verdict.wouldSuppressNewEntries && enforceable;

  const detail = blocked
    ? `news gate: ${verdict.detail}`
    : verdict.wouldSuppressNewEntries
      ? `news gate would suppress (${verdict.reason}: ${verdict.detail}) but is not enforced: ${
          optedIn ? "coverage is not proven for this instrument" : "you have news blocking switched off"
        }`
      : `news gate clear: ${verdict.detail}`;

  await recordEvaluation(db, {
    boundary: args.boundary,
    verdict,
    blocked,
    detail,
    signalId: args.signalId ?? null,
    deliveryId: args.deliveryId ?? null,
  });

  return { verdict: { ...verdict, enforced: blocked }, blocked, detail };
}

async function recordEvaluation(
  db: SupabaseClient,
  args: {
    boundary: NewsBoundary;
    verdict: NewsPolicyVerdict;
    blocked: boolean;
    detail: string;
    signalId: string | null;
    deliveryId: number | null;
  },
): Promise<void> {
  const decision = args.blocked
    ? "suppressed"
    : args.verdict.wouldSuppressNewEntries
      ? "would_suppress"
      : args.verdict.mode === "enforcing"
        ? "allowed"
        : "would_allow";
  try {
    await db.from("news_policy_evaluations").insert({
      boundary: args.boundary,
      instrument: args.verdict.symbol,
      mode: args.blocked ? "enforcing" : args.verdict.mode,
      decision,
      coverage_state: args.verdict.coverageState === "unproven" ? "unknown" : args.verdict.coverageState,
      required_currencies: [...new Set(args.verdict.requiredScopes.map((s) => s.currency))],
      required_families: [...new Set(args.verdict.requiredScopes.map((s) => s.family))],
      news_snapshot_version: NEWS_GATE_VERSION,
      news_policy_version: NEWS_POLICY_VERSION,
      reason: args.detail.slice(0, 500),
      signal_id: args.signalId,
      delivery_id: args.deliveryId,
    } as never);
  } catch (err) {
    console.error(
      "[news-gate] evaluation record failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
