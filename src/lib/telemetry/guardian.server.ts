/**
 * Prompt 14 Stage 5 — Risk Guardian I/O.
 *
 * Availability is decided FIRST, by `riskGuardianAvailability` against the
 * broker's own account information. Unsupported accounts (MT5 NETTING is the
 * verified case) and accounts without the paid Risk Management feature are
 * recorded as unsupported WITH the reason, and no tracker is created — the UI can
 * then never imply that something is being watched when it is not.
 *
 * Tracker events are stored idempotently by fingerprint, so re-reading the same
 * window cannot inflate the breach list.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { riskGuardianAvailability } from "@/lib/metaapi/classify";
import { classifyMetaApiFailure } from "@/lib/metaapi/errors";
import {
  createTracker,
  fetchTrackerEvents,
  listTrackers,
} from "@/lib/metaapi/risk-management.server";
import type { BrokerAccountInformation } from "@/lib/metaapi/types";
import { DEFAULT_TRACKER_PLANS, normaliseTrackerEvent, type TrackerPlan } from "./guardian";

export interface GuardianSyncResult {
  available: boolean;
  reason: string | null;
  created: number;
  events: number;
  errors: string[];
}

function vendorIdOf(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  const id = row["_id"] ?? row["id"];
  return typeof id === "string" && id ? id : null;
}

/**
 * Ensure the operator-configured trackers exist for one account, then pull recent
 * breach events.
 *
 * Never throws for a vendor failure: the reason is returned and stored, so a
 * telemetry problem cannot interrupt anything else.
 */
export async function syncAccountGuardian(input: {
  accountId: string;
  userId: string;
  metaapiAccountId: string;
  info: BrokerAccountInformation;
  riskFeatureEnabled: boolean;
  plans?: TrackerPlan[];
}): Promise<GuardianSyncResult> {
  const availability = riskGuardianAvailability(input.info, input.riskFeatureEnabled);

  if (!availability.available) {
    await supabaseAdmin
      .from("connected_trading_accounts")
      .update({
        risk_guardian_available: false,
        risk_guardian_reason: availability.reason,
      } as never)
      .eq("id", input.accountId);
    // Record the unsupported state against any tracker rows that already exist,
    // so a stale row cannot keep reading as "watching".
    await supabaseAdmin
      .from("account_risk_trackers")
      .update({ supported: false, unsupported_reason: availability.reason } as never)
      .eq("account_id", input.accountId);
    return { available: false, reason: availability.reason, created: 0, events: 0, errors: [] };
  }

  await supabaseAdmin
    .from("connected_trading_accounts")
    .update({ risk_guardian_available: true, risk_guardian_reason: null } as never)
    .eq("id", input.accountId);

  const plans = input.plans ?? DEFAULT_TRACKER_PLANS;
  const result: GuardianSyncResult = {
    available: true,
    reason: null,
    created: 0,
    events: 0,
    errors: [],
  };

  let existing: Record<string, unknown>[] = [];
  try {
    existing = await listTrackers(input.metaapiAccountId);
  } catch (err) {
    result.reason = classifyMetaApiFailure(err).message;
    return result;
  }

  for (const plan of plans) {
    let vendorId = vendorIdOf(existing.find((t) => t["name"] === plan.name));

    if (!vendorId) {
      try {
        vendorId =
          (
            await createTracker(input.metaapiAccountId, {
              name: plan.name,
              period: plan.period,
              relativeDrawdownThreshold: plan.relativeDrawdownThreshold,
            })
          )?.id ?? null;
        if (vendorId) result.created += 1;
      } catch (err) {
        result.errors.push(`${plan.key}: ${classifyMetaApiFailure(err).message}`);
      }
    }

    const { data: trackerRow } = await supabaseAdmin
      .from("account_risk_trackers")
      .upsert(
        {
          account_id: input.accountId,
          user_id: input.userId,
          period: plan.period,
          threshold_kind: "relative_drawdown",
          threshold_value: plan.relativeDrawdownThreshold,
          name: plan.name,
          vendor_tracker_id: vendorId,
          supported: true,
          unsupported_reason: null,
          last_error: vendorId ? null : "the broker-side tracker could not be created",
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "account_id,period,threshold_kind" },
      )
      .select("id")
      .maybeSingle();

    const trackerId = (trackerRow as { id: string } | null)?.id ?? null;
    if (!vendorId || !trackerId) continue;

    try {
      for (const raw of await fetchTrackerEvents(input.metaapiAccountId, vendorId)) {
        const event = normaliseTrackerEvent(raw);
        // No fingerprint and no time means we cannot store it idempotently, and a
        // duplicate breach would misrepresent the account. Skip it.
        if (!event.fingerprint.replace(/\|/g, "") || !event.eventAt) continue;
        const { error } = await supabaseAdmin.from("account_risk_events").upsert(
          {
            account_id: input.accountId,
            tracker_id: trackerId,
            user_id: input.userId,
            fingerprint: event.fingerprint,
            payload: event.payload as never,
            exceeded_threshold_type: "relative_drawdown",
            absolute_drawdown: event.absoluteDrawdown,
            relative_drawdown: event.relativeDrawdown,
            event_at: event.eventAt,
          } as never,
          { onConflict: "tracker_id,fingerprint", ignoreDuplicates: true },
        );
        if (!error) result.events += 1;
      }
    } catch (err) {
      const message = classifyMetaApiFailure(err).message;
      result.errors.push(`${plan.key}: ${message}`);
      await supabaseAdmin
        .from("account_risk_trackers")
        .update({ last_error: message } as never)
        .eq("id", trackerId);
    }
  }

  return result;
}
