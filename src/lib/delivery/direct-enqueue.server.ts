/**
 * Automatic broker orders: WHICH published setups reach an armed account.
 *
 * The DB trigger used to enqueue every non-C signal to every armed account,
 * ignoring the owner's instrument list, session list, grade threshold and daily
 * cap. Those rules now decide it, through the canonical implementation in
 * `@/lib/delivery/eligibility` (channel `alert`, per the product decision that
 * automatic orders follow the same rules as alerts). There is deliberately no
 * SQL mirror of those rules.
 *
 * This module only ever REDUCES what is sent. Every safety gate downstream
 * (broker-confirmed demo, READY phase, trade allowed, investor mode, symbol
 * resolution, equity freshness, margin, exposure boundary, system-wide switches,
 * pre-send revalidation) is unchanged and still authoritative.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Grade } from "@/lib/db-types";
import { fetchDayFrame, type FrameClient } from "./day-frame";
import {
  buildCapFrame,
  evaluateEligibility,
  type EligibilitySettings,
  type EligibilitySignal,
} from "./eligibility";

export interface DirectEnqueueSignal {
  id: string;
  instrument: string;
  grade: string;
  session: string;
  detectedAt?: string;
}

interface AccountRow {
  id: string;
  user_id: string;
  mode: string;
  broker_account_type: string;
}

interface SettingsRow {
  user_id: string;
  instruments: string[] | null;
  sessions: string[] | null;
  alert_min_grade: string | null;
  daily_setup_cap: number | null;
  execution_config_version: number | null;
}

export interface DirectEnqueueOutcome {
  /** Accounts a delivery row was written for. */
  enqueued: number;
  /** Armed accounts skipped because the owner's own rules excluded the setup. */
  filtered: number;
  /** Why nothing was enqueued, when nothing was. */
  reason: string | null;
}

/**
 * Enqueue `metaapi_direct` deliveries for armed accounts whose owner's rules
 * accept this signal. Safe to call twice: the `(user_id, signal_id,
 * bridge_profile)` conflict key makes the insert idempotent.
 */
export async function enqueueDirectDeliveries(
  db: SupabaseClient,
  signal: DirectEnqueueSignal,
  nowMs: number = Date.now(),
): Promise<DirectEnqueueOutcome> {
  const empty = (reason: string): DirectEnqueueOutcome => ({ enqueued: 0, filtered: 0, reason });

  // C-Grade is never automatically executed. Unchanged rule.
  if (signal.grade === "C") return empty("c_grade_never_executes");

  const { data: controlRows, error: controlError } = await db
    .from("execution_controls")
    .select("demo_auto_enabled, live_auto_enabled")
    .limit(1);
  if (controlError) return empty(`execution_controls_unreadable: ${controlError.message}`);
  const controls = (controlRows ?? [])[0] as
    | { demo_auto_enabled: boolean | null; live_auto_enabled: boolean | null }
    | undefined;
  const demoAuto = controls?.demo_auto_enabled === true;
  const liveAuto = controls?.live_auto_enabled === true;
  if (!demoAuto && !liveAuto) return empty("automatic_execution_disabled");

  const { data: accountRows, error: accountError } = await db
    .from("connected_trading_accounts")
    .select("id, user_id, mode, broker_account_type")
    .is("disconnected_at", null)
    .eq("is_benchmark", false)
    .eq("intent_conflict", false)
    .eq("trade_allowed", true)
    .in("phase", ["connected", "ready"])
    .in("mode", ["demo_auto", "live_auto"])
    .or("investor_mode.is.null,investor_mode.eq.false");
  if (accountError) return empty(`accounts_unreadable: ${accountError.message}`);

  const armed = ((accountRows ?? []) as AccountRow[]).filter(
    (a) =>
      (a.mode === "demo_auto" && a.broker_account_type === "demo" && demoAuto) ||
      (a.mode === "live_auto" && a.broker_account_type === "real" && liveAuto),
  );
  if (armed.length === 0) return empty("no_armed_account");

  const userIds = [...new Set(armed.map((a) => a.user_id))];
  const { data: settingsRows, error: settingsError } = await db
    .from("scanner_settings")
    .select(
      "user_id, instruments, sessions, alert_min_grade, daily_setup_cap, execution_config_version",
    )
    .in("user_id", userIds);
  if (settingsError) return empty(`settings_unreadable: ${settingsError.message}`);
  const settingsByUser = new Map(
    ((settingsRows ?? []) as SettingsRow[]).map((row) => [row.user_id, row]),
  );

  const target: EligibilitySignal = {
    id: signal.id,
    detected_at: signal.detectedAt ?? new Date(nowMs).toISOString(),
    instrument: signal.instrument,
    grade: signal.grade as Grade,
    trading_session: signal.session,
  };

  // The complete UTC-day frame is what makes the per-user cap truthful. An
  // unreadable frame must never silently understate consumption, so we fall back
  // to the target alone (cap effectively unlimited for this publish) rather than
  // to a wrong count.
  let frame: EligibilitySignal[] = [target];
  try {
    const fetched = await fetchDayFrame(db as unknown as FrameClient, nowMs);
    frame = fetched.some((s) => s.id === target.id) ? fetched : [...fetched, target];
  } catch (err) {
    console.error("direct enqueue frame unavailable", err);
  }

  const rows: Record<string, unknown>[] = [];
  let filtered = 0;

  for (const account of armed) {
    const row = settingsByUser.get(account.user_id);
    if (!row) {
      // No settings row means no rules to honour; refuse rather than guess.
      filtered += 1;
      continue;
    }
    const grade = (row.alert_min_grade ?? "B") as Grade;
    const settings: EligibilitySettings = {
      instruments: row.instruments ?? [],
      sessions: row.sessions ?? [],
      min_grade: grade,
      alert_min_grade: grade,
      daily_setup_cap: row.daily_setup_cap ?? 0,
    };
    const cappedOutIds = buildCapFrame(frame, settings, "alert", nowMs);
    const verdict = evaluateEligibility({
      signal: target,
      settings,
      channel: "alert",
      now: nowMs,
      cappedOutIds,
    });
    if (!verdict.eligible) {
      filtered += 1;
      continue;
    }
    rows.push({
      user_id: account.user_id,
      signal_id: signal.id,
      bridge_profile: `metaapi_direct:${account.id}`,
      destination_type: "metaapi_direct",
      connected_account_id: account.id,
      account_mode: account.mode,
      dry_run: false,
      execution_config_version: row.execution_config_version,
    });
  }

  if (rows.length === 0) {
    return { enqueued: 0, filtered, reason: "filtered_by_user_rules" };
  }

  const { error: insertError } = await db
    .from("execution_deliveries")
    .upsert(rows, { onConflict: "user_id,signal_id,bridge_profile", ignoreDuplicates: true });
  if (insertError) {
    return { enqueued: 0, filtered, reason: `enqueue_failed: ${insertError.message}` };
  }
  return { enqueued: rows.length, filtered, reason: null };
}
