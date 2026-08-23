/**
 * Prompt 14 Stage 5 closure — the bounded Risk Guardian pass.
 *
 * `syncAccountGuardian` existed but nothing ever called it, so no drawdown
 * tracker was ever created and no breach was ever recorded. This module is the
 * missing caller, and it is deliberately shaped exactly like the MetaStats pass:
 *
 *  - Risk Management is a PAID vendor add-on, so an account is only eligible
 *    when the operator explicitly enabled `risk_management_api_enabled` for it;
 *  - read volume is leased per account through `claim_account_telemetry` under
 *    its own `risk_management` budget source, so a page view can never trigger a
 *    paid read and two worker runs cannot double-spend;
 *  - a per-account failure is caught and summarised. A telemetry problem may
 *    never interrupt the scanner, the queue or the evidence worker.
 *
 * Nothing here touches a grade, an eligibility decision, a research population
 * or a published statistic.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyMetaApiFailure } from "@/lib/metaapi/errors";
import { fetchAccountFacts } from "@/lib/metaapi/accounts.server";
import { syncAccountGuardian } from "./guardian.server";
import { TELEMETRY_MIN_INTERVAL_SECONDS } from "./metastats";

/** Own source key, so the MetaStats budget and this one cannot starve each other. */
export const GUARDIAN_BUDGET_SOURCE = "risk_management";

/** Bounded per run for the same cost reason as the statistics pass. */
export const GUARDIAN_ITEMS_PER_RUN = 5;

export interface GuardianPassSummary {
  considered: number;
  claimed: number;
  available: number;
  unsupported: number;
  trackersCreated: number;
  events: number;
  errors: string[];
}

interface Candidate {
  id: string;
  user_id: string;
  region: string;
  metaapi_account_id: string;
}

async function candidates(limit: number): Promise<Candidate[]> {
  const { data, error } = await supabaseAdmin
    .from("connected_trading_accounts")
    .select(
      "id, user_id, region, metaapi_account_id, connected_account_features!inner(risk_management_api_enabled)",
    )
    .is("disconnected_at", null)
    .eq("phase", "ready")
    .not("metaapi_account_id", "is", null)
    .eq("connected_account_features.risk_management_api_enabled", true)
    .limit(limit * 4);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Candidate[]).filter((row) => Boolean(row.metaapi_account_id));
}

async function claim(accountId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("claim_account_telemetry", {
    _account_id: accountId,
    _source: GUARDIAN_BUDGET_SOURCE,
    _min_interval_seconds: TELEMETRY_MIN_INTERVAL_SECONDS,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/**
 * Sync drawdown trackers and pull recent breaches for at most `limit` eligible
 * accounts. Returns a summary and never throws because one account failed.
 */
export async function collectRiskGuardian(
  limit = GUARDIAN_ITEMS_PER_RUN,
): Promise<GuardianPassSummary> {
  const summary: GuardianPassSummary = {
    considered: 0,
    claimed: 0,
    available: 0,
    unsupported: 0,
    trackersCreated: 0,
    events: 0,
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
      // Availability is decided against the BROKER's own account information, so
      // an unsupported account (MT5 netting is the verified case) is recorded as
      // unsupported with its reason rather than silently skipped.
      const facts = await fetchAccountFacts(row.metaapi_account_id, row.region);
      if (!facts) {
        summary.errors.push(`${row.id}: your broker returned no account information`);
        continue;
      }

      const result = await syncAccountGuardian({
        accountId: row.id,
        userId: row.user_id,
        metaapiAccountId: row.metaapi_account_id,
        info: facts.info,
        riskFeatureEnabled: true,
      });

      if (result.available) summary.available += 1;
      else summary.unsupported += 1;
      summary.trackersCreated += result.created;
      summary.events += result.events;
      if (result.reason && result.available) summary.errors.push(`${row.id}: ${result.reason}`);
      for (const error of result.errors) summary.errors.push(`${row.id}: ${error}`);
    } catch (err) {
      summary.errors.push(`${row.id}: ${classifyMetaApiFailure(err).message}`);
    }
  }

  return summary;
}
