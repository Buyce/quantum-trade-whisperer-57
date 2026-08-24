/**
 * Prompt 14 Stage 5 — the bounded MetaStats collection pass.
 *
 * MetaStats is a PAID, rate-limited vendor service, so read volume is owned by
 * the server and made durable in the database:
 *
 *  - `claim_account_telemetry` is a per-account lease that pushes
 *    `next_allowed_at` forward atomically, so two concurrent worker runs cannot
 *    double-spend the budget, the per-account minimum interval is enforced in
 *    SQL, and a page view can never trigger a paid read;
 *  - a fixed item cap per run bounds the cost of any single pass;
 *  - a billing or permission refusal PARKS the account (long backoff, one
 *    probing retry later) instead of looping against a wall that keeps charging.
 *
 * A `processing` answer is stored as `processing` with no metrics at all, never
 * as zeros — see `./metastats.ts`. Nothing here may touch a grade, an
 * eligibility decision, a research population or a published statistic, and a
 * collection failure may not interrupt the scanner, the queue or the evidence
 * worker, so every per-account error is caught and summarised.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyMetaApiFailure, type MetaApiFailureKind } from "@/lib/metaapi/errors";
import { fetchMetrics } from "@/lib/metaapi/metastats.server";
import {
  TELEMETRY_ITEMS_PER_RUN,
  TELEMETRY_MIN_INTERVAL_SECONDS,
  reasonShouldPark,
  toSnapshot,
  type TelemetrySnapshot,
} from "./metastats";

/** Backoff applied to an account whose refusal will not resolve by itself. */
const PARK_SECONDS = 24 * 3600;

/**
 * Refusals that will NOT clear on their own: retrying hourly would keep failing
 * and, in the billing case, keep costing. The account is parked and probed once
 * after a long backoff instead.
 */
const PARK_KINDS: MetaApiFailureKind[] = [
  "provider_billing",
  "feature_not_enabled",
  "auth",
  "permission",
  "not_found",
];

export interface CollectSummary {
  considered: number;
  claimed: number;
  ok: number;
  processing: number;
  unavailable: number;
  parked: number;
  errors: string[];
}

interface Candidate {
  id: string;
  user_id: string;
  metaapi_account_id: string;
  /** Region comes from MetaApi's own account metadata; the host needs it. */
  region: string | null;
}

/**
 * Accounts eligible for a paid statistics read: connected, provisioned, and with
 * the MetaStats feature actually enabled for them. The budget decides WHEN; this
 * only decides WHO is even eligible.
 */
async function candidates(limit: number): Promise<Candidate[]> {
  const { data, error } = await supabaseAdmin
    .from("connected_trading_accounts")
    .select(
      "id, user_id, metaapi_account_id, region, connected_account_features!inner(metastats_api_enabled)",
    )
    .is("disconnected_at", null)
    .eq("phase", "ready")
    .not("metaapi_account_id", "is", null)
    .eq("connected_account_features.metastats_api_enabled", true)

    .limit(limit * 4);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Candidate[]).filter((row) => Boolean(row.metaapi_account_id));
}

async function claim(accountId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("claim_account_telemetry", {
    _account_id: accountId,
    _source: "metastats",
    _min_interval_seconds: TELEMETRY_MIN_INTERVAL_SECONDS,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

async function park(accountId: string, reason: string): Promise<void> {
  await supabaseAdmin.rpc("park_account_telemetry", {
    _account_id: accountId,
    _source: "metastats",
    _reason: reason,
    _retry_after_seconds: PARK_SECONDS,
  });
}

async function storeSnapshot(row: Candidate, snapshot: TelemetrySnapshot): Promise<void> {
  await supabaseAdmin.from("account_telemetry_snapshots").insert({
    account_id: row.id,
    user_id: row.user_id,
    source: "metastats",
    status: snapshot.status,
    reason: snapshot.reason,
    retry_after_seconds: snapshot.retryAfterSeconds,
    // `processing` / `unavailable` carry no metrics object, so nothing can be
    // read back later and rounded down to "zero trades".
    metrics: (snapshot.metrics ?? {}) as never,
    observed_at: snapshot.observedAt ?? new Date().toISOString(),
  } as never);
}

/**
 * Collect at most `limit` account snapshots. Returns a summary and never throws
 * because one account failed.
 */
export async function collectAccountTelemetry(
  limit = TELEMETRY_ITEMS_PER_RUN,
): Promise<CollectSummary> {
  const summary: CollectSummary = {
    considered: 0,
    claimed: 0,
    ok: 0,
    processing: 0,
    unavailable: 0,
    parked: 0,
    errors: [],
  };

  let pool: Candidate[] = [];
  try {
    pool = await candidates(limit);
  } catch (err) {
    summary.errors.push(`candidate read failed: ${(err as Error).message}`);
    return summary;
  }
  summary.considered = pool.length;

  for (const row of pool) {
    if (summary.claimed >= limit) break;

    try {
      if (!(await claim(row.id))) continue;
    } catch (err) {
      summary.errors.push(`claim failed for ${row.id}: ${(err as Error).message}`);
      continue;
    }
    summary.claimed += 1;

    try {
      const snapshot = toSnapshot(await fetchMetrics(row.metaapi_account_id, row.region));
      await storeSnapshot(row, snapshot);

      if (snapshot.status === "ok") {
        summary.ok += 1;
      } else if (snapshot.status === "processing") {
        // The vendor told us when to come back; respect it rather than guessing.
        summary.processing += 1;
        if (snapshot.retryAfterSeconds) {
          await supabaseAdmin
            .from("telemetry_budget")
            .update({
              next_allowed_at: new Date(
                Date.now() + snapshot.retryAfterSeconds * 1000,
              ).toISOString(),
            } as never)
            .eq("account_id", row.id)
            .eq("source", "metastats");
        }
      } else {
        summary.unavailable += 1;
        // `unavailable` carries only a sentence, so the park decision is made on
        // that sentence rather than pretending we still have the failure kind.
        if (reasonShouldPark(snapshot.reason)) {
          await park(row.id, snapshot.reason ?? "the statistics service refused the request");
          summary.parked += 1;
        }
      }
    } catch (err) {
      const failure = classifyMetaApiFailure(err);
      summary.errors.push(`${row.id}: ${failure.message}`);
      if (PARK_KINDS.includes(failure.kind)) {
        await park(row.id, failure.message).catch(() => undefined);
        summary.parked += 1;
      }
    }
  }

  return summary;
}
