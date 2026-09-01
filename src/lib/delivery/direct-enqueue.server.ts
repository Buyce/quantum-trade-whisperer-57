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
 * On top of eligibility there is ONE optional, off-by-default, reduce-only extra
 * rule: the owner's intelligence gate (`@/lib/delivery/intel-gate`). Like every
 * rule here it can only ever refuse.
 *
 * This module only ever REDUCES what is sent. Every safety gate downstream
 * (broker-confirmed demo, READY phase, trade allowed, investor mode, symbol
 * resolution, equity freshness, margin, exposure boundary, system-wide switches,
 * pre-send revalidation) is unchanged and still authoritative.
 *
 * Every decision — including every refusal — is recorded through
 * `recordEnqueueDecisions`, so an empty delivery ledger is never ambiguous.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTO_ORDER_WINDOW_MAX_MINUTES,
  clampAutoOrderWindowMinutes,
  clampAdaptiveCeilingFloor,
  clampAdaptiveCeilingMax,
  clampConcurrentOrderCeiling,
  clampDailyOrderCeiling,
  clampPerSymbolOrderCeiling,
  type Grade,
} from "@/lib/db-types";
import { assessFreshness, describeCeilings, effectiveCeilings } from "./adaptive-ceilings";
import {
  describeDuplicateOrder,
  findDuplicateOrder,
  type OrderPlanIdentity,
  type RestingOrder,
} from "./duplicate-orders";
import type { RegimeStatRow } from "@/lib/learning/regime";
import { fetchDayFrame, type FrameClient } from "./day-frame";
import {
  buildCapFrame,
  evaluateEligibility,
  type EligibilitySettings,
  type EligibilitySignal,
} from "./eligibility";
import { evaluateIntelGate, gateConfigured, type IntelGateSettings } from "./intel-gate";
import { recordEnqueueDecisions, type EnqueueDecisionRow } from "./enqueue-log.server";
import {
  INSTRUMENT_NOT_APPROVED,
  describeStage,
  lifecycleAllows,
} from "@/lib/instruments/lifecycle";
import { readLifecycleView } from "@/lib/instruments/lifecycle.server";
import { neverReachedBroker, occupiesSlot } from "@/lib/evidence/order-state";
import { formatDuration, marketStatus } from "@/lib/market-hours";

export interface DirectEnqueueSignal {
  id: string;
  instrument: string;
  grade: string;
  session: string;
  detectedAt?: string;
  /** Needed only by the optional intelligence gate. */
  direction?: string;
  /** Needed only by the optional intelligence gate. */
  volatilityIndex?: number | null;
}

export function executionWindowAgeMinutes(
  signal: Pick<DirectEnqueueSignal, "detectedAt">,
  nowMs: number,
): number | null {
  if (!signal.detectedAt) return null;
  const detected = new Date(signal.detectedAt).getTime();
  if (!Number.isFinite(detected)) return null;
  return Math.round((nowMs - detected) / 60_000);
}

/**
 * Past the automatic-order window.
 *
 * The window is per owner (`scanner_settings.auto_order_window_minutes`). The
 * default here is the WIDEST supported window, so a shared pre-settings check can
 * only ever discard setups that no owner could legally act on; the owner's own,
 * narrower window is applied once their settings are known.
 */
export function executionWindowExpired(
  signal: Pick<DirectEnqueueSignal, "detectedAt">,
  nowMs: number,
  windowMinutes: number = AUTO_ORDER_WINDOW_MAX_MINUTES,
): boolean {
  if (!signal.detectedAt) return false;
  const detected = new Date(signal.detectedAt).getTime();
  if (!Number.isFinite(detected)) return false;
  return nowMs - detected > clampAutoOrderWindowMinutes(windowMinutes) * 60_000;
}

interface AccountRow {
  id: string;
  user_id: string;
  mode: string;
  broker_account_type: string;
  /** Broker-reported equity observation time; drives the freshness reading. */
  broker_observed_at?: string | null;
}

interface SettingsRow {
  user_id: string;
  instruments: string[] | null;
  sessions: string[] | null;
  alert_min_grade: string | null;
  daily_setup_cap: number | null;
  execution_config_version: number | null;
  auto_intel_gate_enabled: boolean | null;
  auto_intel_min_win_pct: number | string | null;
  auto_intel_min_sample: number | null;
  auto_execute_c_grade: boolean | null;
  /** Legacy single ceiling, kept only for historical rows. */
  maximum_active_signal_orders: number | null;
  /** How many automatic orders may be unresolved at once (0-10). */
  maximum_concurrent_signal_orders: number | null;
  /** How many automatic orders may be created per UTC day (0-25). */
  maximum_daily_signal_orders: number | null;
  /** Owner opt-in: let a regime with too few samples pass the intelligence gate. */
  allow_unmeasured_intel: boolean | null;
  /** Owner's automatic-order window, in minutes (0–360). */
  auto_order_window_minutes: number | null;
  /** How many automatic orders one instrument may consume per UTC day (0-25). */
  maximum_daily_orders_per_symbol: number | null;
  /** Owner opt-in: move the daily and per-symbol ceilings with broker freshness. */
  adaptive_order_ceilings_enabled: boolean | null;
  adaptive_order_ceiling_max: number | null;
  adaptive_order_ceiling_floor: number | null;
}

/**
 * Delivery states that still represent a live automatic order for ceiling
 * purposes: queued, in-flight or accepted. A refused or failed row consumed no
 * order, so it must not permanently spend the owner's ceiling.
 */
const OCCUPYING_STATES = ["pending", "claimed", "sent", "acknowledged", "unknown"] as const;

/** UTC-day start, matching the cap semantics used everywhere else. */
function dayStartIso(nowMs: number): string {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * The automatic-order occupancies for these owners.
 *
 * `concurrent` — deliveries that are still UNRESOLVED right now (queued, in
 * flight, or resting at the broker unresolved). This is what "how many orders am
 * I running at once" means, and it falls as orders resolve.
 * `daily` — how many automatic orders were CREATED so far in the current UTC day,
 * which is a throughput count and does not fall when an order closes.
 * `perSymbol` — the same UTC-day throughput count, split by instrument, keyed
 * `user_id|INSTRUMENT`. It exists so one symbol cannot spend the whole day.
 *
 * All are ceilings, never quotas. An unreadable count fails CLOSED (treated as
 * at the ceiling) rather than permitting unbounded orders. Dry-run rows reach no
 * broker and hold no order, so they spend no ceiling.
 */
export function perSymbolKey(userId: string, instrument: string): string {
  return `${userId}|${instrument.toUpperCase()}`;
}

export async function occupiedOrderCounts(
  db: SupabaseClient,
  userIds: string[],
  nowMs: number,
): Promise<{
  counts: Map<string, number>;
  daily: Map<string, number>;
  perSymbol: Map<string, number>;
  readable: boolean;
}> {
  const counts = new Map<string, number>();
  const daily = new Map<string, number>();
  const perSymbol = new Map<string, number>();
  if (userIds.length === 0) return { counts, daily, perSymbol, readable: true };
  // Bounded lookback: anything older than a week cannot still be an unresolved
  // automatic order, because every owner window tops out at six hours.
  const since = new Date(nowMs - 7 * 24 * 60 * 60_000).toISOString();
  const { data, error } = await db
    .from("execution_deliveries")
    .select(
      "user_id, state, enqueued_at, dry_run, broker_order_state, submitted_at, client_id, broker_order_id, signal:scanned_signals(instrument)",
    )
    .in("user_id", userIds)
    .in("state", OCCUPYING_STATES as unknown as string[])
    .neq("dry_run", true)
    .gte("enqueued_at", since);
  if (error) {
    console.error("occupied order counts unreadable", error.message);
    return { counts, daily, perSymbol, readable: false };
  }
  const dayStart = dayStartIso(nowMs);
  type Row = {
    user_id: string;
    enqueued_at: string | null;
    broker_order_state?: string | null;
    submitted_at?: string | null;
    client_id?: string | null;
    broker_order_id?: string | null;
    signal?: { instrument: string | null } | { instrument: string | null }[] | null;
  };
  for (const row of (data ?? []) as Row[]) {
    // Concurrency follows the BROKER: a closed, cancelled or broker-absent order
    // holds nothing, so it gives the slot back immediately. Daily throughput is
    // unaffected — it counts orders created, not orders still running.
    const occupies =
      !neverReachedBroker({
        submittedAt: row.submitted_at ?? null,
        clientId: row.client_id ?? null,
        brokerOrderId: row.broker_order_id ?? null,
      }) && occupiesSlot(row.broker_order_state as never);
    if (occupies) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
    if (row.enqueued_at !== null && row.enqueued_at >= dayStart) {
      daily.set(row.user_id, (daily.get(row.user_id) ?? 0) + 1);
      const embedded = Array.isArray(row.signal) ? row.signal[0] : row.signal;
      const instrument = embedded?.instrument ?? null;
      if (instrument) {
        const key = perSymbolKey(row.user_id, instrument);
        perSymbol.set(key, (perSymbol.get(key) ?? 0) + 1);
      }
    }
  }
  return { counts, daily, perSymbol, readable: true };
}

/**
 * Every automatic order this owner already holds that is NOT resolved: queued,
 * in flight, or accepted and resting at the broker. Terminal rows (refused,
 * failed, expired, filled and reconciled) are excluded, so a cleared setup never
 * blocks a fresh attempt.
 *
 * The plan behind each row comes from its own signal snapshot, with the submitted
 * (grid-snapped) entry preferred when dispatch already recorded one, because that
 * is the price actually resting at the broker.
 */
export async function heldOrdersByUser(
  db: SupabaseClient,
  userIds: string[],
  nowMs: number,
): Promise<{ held: Map<string, RestingOrder[]>; readable: boolean }> {
  const held = new Map<string, RestingOrder[]>();
  if (userIds.length === 0) return { held, readable: true };
  const since = new Date(nowMs - 7 * 24 * 60 * 60_000).toISOString();
  const { data, error } = await db
    .from("execution_deliveries")
    .select(
      "id, user_id, signal_id, submitted_entry, published_entry, broker_order_state, submitted_at, client_id, broker_order_id, signal:scanned_signals(instrument, direction, entry_price)",
    )
    .in("user_id", userIds)
    .in("state", OCCUPYING_STATES as unknown as string[])
    .neq("dry_run", true)
    .gte("enqueued_at", since);
  if (error) {
    console.error("held automatic orders unreadable", error.message);
    return { held, readable: false };
  }
  type Row = {
    id: number;
    user_id: string;
    signal_id: string | null;
    submitted_entry: number | string | null;
    published_entry: number | string | null;
    broker_order_state?: string | null;
    submitted_at?: string | null;
    client_id?: string | null;
    broker_order_id?: string | null;
    signal?:
      | { instrument: string | null; direction: string | null; entry_price: number | string | null }
      | {
          instrument: string | null;
          direction: string | null;
          entry_price: number | string | null;
        }[]
      | null;
  };
  const number = (value: number | string | null | undefined): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  for (const row of (data ?? []) as Row[]) {
    // A broker-closed, cancelled or absent order rests nowhere, so it cannot be
    // the duplicate of a fresh attempt.
    if (
      neverReachedBroker({
        submittedAt: row.submitted_at ?? null,
        clientId: row.client_id ?? null,
        brokerOrderId: row.broker_order_id ?? null,
      })
    )
      continue;
    if (!occupiesSlot(row.broker_order_state as never)) continue;
    const embedded = Array.isArray(row.signal) ? row.signal[0] : row.signal;
    const instrument = embedded?.instrument ?? null;
    if (!instrument) continue;
    const entry =
      number(row.submitted_entry) ?? number(row.published_entry) ?? number(embedded?.entry_price);
    const list = held.get(row.user_id) ?? [];
    list.push({
      deliveryId: row.id,
      signalId: row.signal_id,
      instrument,
      direction: embedded?.direction ?? null,
      entry,
    });
    held.set(row.user_id, list);
  }
  return { held, readable: true };
}

/**
 * The plan this signal would place, read from the authoritative signal row, plus
 * the broker tick that decides when two entries are "the same price". Both are
 * optional: when either cannot be read, the duplicate check simply does not fire
 * (it is a refusal, never a permission).
 */
export async function readDuplicateContext(
  db: SupabaseClient,
  signal: DirectEnqueueSignal,
): Promise<{ plan: OrderPlanIdentity | null; tickSize: number | null }> {
  const [{ data: signalRow }, { data: specRow }] = await Promise.all([
    db
      .from("scanned_signals")
      .select("instrument, direction, entry_price")
      .eq("id", signal.id)
      .maybeSingle(),
    db
      .from("broker_symbol_specs")
      .select("tick_size")
      .eq("symbol", signal.instrument)
      .maybeSingle(),
  ]);
  const row = signalRow as {
    instrument: string | null;
    direction: string | null;
    entry_price: number | string | null;
  } | null;
  const spec = specRow as { tick_size: number | string | null } | null;
  const tick =
    spec?.tick_size === null || spec?.tick_size === undefined ? null : Number(spec.tick_size);
  const entry =
    row?.entry_price === null || row?.entry_price === undefined ? null : Number(row.entry_price);
  return {
    plan:
      row === null
        ? null
        : {
            instrument: row.instrument ?? signal.instrument,
            direction: row.direction ?? signal.direction ?? null,
            entry: entry !== null && Number.isFinite(entry) ? entry : null,
          },
    tickSize: tick !== null && Number.isFinite(tick) ? tick : null,
  };
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
async function runDirectEnqueue(
  db: SupabaseClient,
  signal: DirectEnqueueSignal,
  nowMs: number = Date.now(),
): Promise<DirectEnqueueOutcome> {
  const decisions: EnqueueDecisionRow[] = [];
  const systemDecision = (decision: string, detail: string | null = null): EnqueueDecisionRow => ({
    user_id: null,
    signal_id: signal.id,
    instrument: signal.instrument,
    grade: signal.grade,
    decision,
    detail,
    enqueued: 0,
    filtered: 0,
  });

  const empty = async (
    reason: string,
    detail: string | null = null,
  ): Promise<DirectEnqueueOutcome> => {
    await recordEnqueueDecisions(db, [systemDecision(reason, detail)]);
    return { enqueued: 0, filtered: 0, reason };
  };

  // C-Grade is refused unless the owner has explicitly opted in
  // (`scanner_settings.auto_execute_c_grade`, default false). The decision is
  // per-owner, so it is made inside the per-account loop below rather than here;
  // an opted-in C-Grade setup still faces every other gate unchanged.

  // Lifecycle: only an instrument approved for execution may be enqueued at all.
  // The pre-send gate repeats this check, because a suspension can land after a
  // delivery is already queued — this one just avoids queuing work that cannot ship.
  // A DEGRADED lifecycle read refuses every non-Wave-0 symbol here rather than
  // treating "unknown" as permission (Phase A2A, R3-FIX).
  const lifecycle = await readLifecycleView(db as unknown as SupabaseClient);
  {
    const gate = lifecycleAllows(lifecycle, signal.instrument, "execute");
    if (!gate.allowed) {
      return await empty(
        INSTRUMENT_NOT_APPROVED,
        lifecycle.degraded
          ? `the lifecycle stage for ${signal.instrument} could not be read`
          : `${signal.instrument} is at lifecycle stage "${gate.stage}" (${describeStage(gate.stage)})`,
      );
    }
  }

  /**
   * Pre-enqueue market gate. The pre-send gate already refuses `market_closed`,
   * but only AFTER a claim and an attempt were spent, and the closed-market
   * backoff then re-asked the same unanswerable question every ten minutes until
   * the owner's window elapsed. A market that is shut at enqueue time cannot be
   * traded now, so the refusal is recorded here and nothing is queued. The
   * pre-send check stays as the authority for a market that closes mid-window.
   * This can only refuse; an open market changes nothing.
   */
  {
    const market = marketStatus(new Date(nowMs));
    if (market.weekendClosed || market.openCount === 0) {
      return await empty(
        "market_closed",
        market.weekendClosed
          ? market.minutesToReopen === null
            ? "the FX week is closed"
            : `the FX week is closed; it reopens in ${formatDuration(market.minutesToReopen)}`
          : "no FX session is open",
      );
    }
  }

  const { data: controlRows, error: controlError } = await db
    .from("execution_controls")
    .select("demo_auto_enabled, live_auto_enabled")
    .limit(1);
  if (controlError) return await empty("execution_controls_unreadable", controlError.message);
  const controls = (controlRows ?? [])[0] as
    { demo_auto_enabled: boolean | null; live_auto_enabled: boolean | null } | undefined;
  const demoAuto = controls?.demo_auto_enabled === true;
  const liveAuto = controls?.live_auto_enabled === true;
  if (!demoAuto && !liveAuto) return await empty("automatic_execution_disabled");

  const { data: accountRows, error: accountError } = await db
    .from("connected_trading_accounts")
    .select("id, user_id, mode, broker_account_type, broker_observed_at")
    .is("disconnected_at", null)
    .eq("is_benchmark", false)
    .eq("intent_conflict", false)
    .eq("trade_allowed", true)
    .in("phase", ["connected", "ready"])
    .in("mode", ["demo_auto", "live_auto"])
    .or("investor_mode.is.null,investor_mode.eq.false");
  if (accountError) return await empty("accounts_unreadable", accountError.message);

  const armed = ((accountRows ?? []) as AccountRow[]).filter(
    (a) =>
      (a.mode === "demo_auto" && a.broker_account_type === "demo" && demoAuto) ||
      (a.mode === "live_auto" && a.broker_account_type === "real" && liveAuto),
  );
  if (armed.length === 0) return await empty("no_armed_account");

  if (executionWindowExpired(signal, nowMs)) {
    const age = executionWindowAgeMinutes(signal, nowMs);
    await recordEnqueueDecisions(
      db,
      armed.map((account) => ({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "execution_window_expired",
        detail: age === null ? null : `${age} minutes old`,
        enqueued: 0,
        filtered: 1,
      })),
    );
    return { enqueued: 0, filtered: armed.length, reason: "execution_window_expired" };
  }

  const userIds = [...new Set(armed.map((a) => a.user_id))];
  const { data: settingsRows, error: settingsError } = await db
    .from("scanner_settings")
    .select(
      "user_id, instruments, sessions, alert_min_grade, daily_setup_cap, execution_config_version, auto_intel_gate_enabled, auto_intel_min_win_pct, auto_intel_min_sample, auto_execute_c_grade, maximum_active_signal_orders, maximum_concurrent_signal_orders, maximum_daily_signal_orders, allow_unmeasured_intel, auto_order_window_minutes, maximum_daily_orders_per_symbol, adaptive_order_ceilings_enabled, adaptive_order_ceiling_max, adaptive_order_ceiling_floor",
    )
    .in("user_id", userIds);
  if (settingsError) return await empty("settings_unreadable", settingsError.message);
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

  // Regime statistics are read once, and only when at least one armed owner has
  // actually configured the gate. Nobody pays for a feature they left off.
  const gateSettingsOf = (row: SettingsRow): IntelGateSettings => ({
    enabled: row.auto_intel_gate_enabled === true,
    minWinPct:
      row.auto_intel_min_win_pct === null || row.auto_intel_min_win_pct === undefined
        ? null
        : Number(row.auto_intel_min_win_pct),
    minSample: Number(row.auto_intel_min_sample ?? 30),
    allowUnmeasured: row.allow_unmeasured_intel === true,
  });
  const anyGate = [...settingsByUser.values()].some((row) => gateConfigured(gateSettingsOf(row)));
  let regimeRows: RegimeStatRow[] = [];
  if (anyGate) {
    const { data: statRows, error: statError } = await db
      .from("regime_stats")
      .select(
        "tier, regime_key, instrument, direction, session, vol_bucket, n_total, n_filled, wins, p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2",
      );
    if (statError) {
      // Fail CLOSED for the gate: an unreadable statistic must not be read as a
      // passing one. `evaluateIntelGate` refuses on an empty row set.
      console.error("direct enqueue regime stats unreadable", statError.message);
    } else {
      regimeRows = (statRows ?? []) as unknown as RegimeStatRow[];
    }
  }

  const rows: Record<string, unknown>[] = [];
  let filtered = 0;

  // Per-owner ceiling on concurrent automatic orders. It can only ever REFUSE:
  // reaching it is never a reason to place an order, and an unreadable count is
  // treated as "at the ceiling".
  const occupancy = await occupiedOrderCounts(db, userIds, nowMs);
  const occupied = new Map(occupancy.counts);
  // One live order per setup. Purely additive: it can only refuse, and when the
  // plan or the held orders cannot be read it does not fire at all.
  const [{ held, readable: heldReadable }, duplicateContext] = await Promise.all([
    heldOrdersByUser(db, userIds, nowMs),
    readDuplicateContext(db, signal),
  ]);
  const candidatePlan: (OrderPlanIdentity & { signalId: string }) | null =
    duplicateContext.plan === null ? null : { ...duplicateContext.plan, signalId: signal.id };

  /**
   * Pre-enqueue grid gate. Without a broker tick size, dispatch can only ever
   * refuse this symbol with a TERMINAL `no_execution_grid` — no price can be
   * placed on a grid that was never published. Queueing such a row spends a
   * claim, an attempt and queue position to reach a refusal already knowable
   * here, so the refusal is recorded now and nothing is queued. This can only
   * refuse; a readable tick size changes nothing.
   */
  if (duplicateContext.tickSize === null || !Number.isFinite(duplicateContext.tickSize)) {
    await recordEnqueueDecisions(
      db,
      armed.map((account) => ({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "no_execution_grid",
        detail: `no broker tick size is published for ${signal.instrument}, so no order price could be placed on its grid`,
        enqueued: 0,
        filtered: 1,
      })),
    );
    return { enqueued: 0, filtered: armed.length, reason: "no_execution_grid" };
  }

  const createdToday = new Map(occupancy.daily);
  const createdTodayPerSymbol = new Map(occupancy.perSymbol);

  for (const account of armed) {
    const row = settingsByUser.get(account.user_id);
    if (!row) {
      // No settings row means no rules to honour; refuse rather than guess.
      filtered += 1;
      decisions.push({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "no_settings_row",
        detail: null,
        enqueued: 0,
        filtered: 1,
      });
      continue;
    }
    // Owner opt-in for C-Grade. Absent or false means the historical refusal.
    const cGradeAllowed = row.auto_execute_c_grade === true;
    if (signal.grade === "C" && !cGradeAllowed) {
      filtered += 1;
      decisions.push({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "c_grade_blocked_by_user_setting",
        detail: null,
        enqueued: 0,
        filtered: 1,
      });
      continue;
    }

    // Owner's own automatic-order window. It can only ever REFUSE: a setup older
    // than the window the owner chose is not placed, whatever the feed still says
    // about the structure being entryable by hand.
    const windowMinutes = clampAutoOrderWindowMinutes(row.auto_order_window_minutes);
    if (windowMinutes === 0 || executionWindowExpired(signal, nowMs, windowMinutes)) {
      const age = executionWindowAgeMinutes(signal, nowMs);
      filtered += 1;
      decisions.push({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "execution_window_expired",
        detail:
          windowMinutes === 0
            ? "your automatic-order window is set to 0"
            : `${age ?? "unknown"} minutes old, window ${windowMinutes} minutes`,
        enqueued: 0,
        filtered: 1,
      });
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
      decisions.push({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: verdict.reason,
        detail: null,
        enqueued: 0,
        filtered: 1,
      });
      continue;
    }

    // Optional, owner-configured, reduce-only. Off by default.
    const gate = gateSettingsOf(row);
    if (gateConfigured(gate)) {
      const gateVerdict = evaluateIntelGate(gate, regimeRows, {
        instrument: signal.instrument,
        direction: signal.direction ?? "",
        session: signal.session,
        volatilityIndex: signal.volatilityIndex ?? null,
      });
      if (!gateVerdict.allowed) {
        filtered += 1;
        decisions.push({
          user_id: account.user_id,
          signal_id: signal.id,
          instrument: signal.instrument,
          grade: signal.grade,
          decision: gateVerdict.reason,
          detail:
            gateVerdict.winPct === null
              ? `filled samples: ${gateVerdict.filledN ?? "unavailable"}`
              : `win-if-filled ${gateVerdict.winPct}% on ${gateVerdict.filledN} filled samples vs threshold ${gate.minWinPct}%`,
          enqueued: 0,
          filtered: 1,
        });
        continue;
      }
    }

    // A setup the owner already holds live at the broker must not be doubled.
    // Republishing the same structure every cycle would otherwise stack several
    // identical resting orders that could all fill at once.
    if (heldReadable && candidatePlan !== null) {
      const duplicate = findDuplicateOrder(
        candidatePlan,
        held.get(account.user_id) ?? [],
        duplicateContext.tickSize,
      );
      if (duplicate) {
        filtered += 1;
        decisions.push({
          user_id: account.user_id,
          signal_id: signal.id,
          instrument: signal.instrument,
          grade: signal.grade,
          decision: "duplicate_resting_order",
          detail: describeDuplicateOrder(duplicate),
          enqueued: 0,
          filtered: 1,
        });
        continue;
      }
    }

    // The owner's ceilings. Every one of them can only ever refuse.

    //
    // The concurrent ceiling is fixed. The daily and per-symbol ceilings are the
    // owner's fixed numbers unless the owner opted into adaptive mode, in which
    // case freshness of the broker facts an order would be sized from decides
    // which of the owner's own bounds applies. Absent or unreadable freshness is
    // treated as degraded, never as room.
    const concurrentCeiling = clampConcurrentOrderCeiling(row.maximum_concurrent_signal_orders);
    const freshness = assessFreshness({
      equityObservedAt: account.broker_observed_at ?? null,
      now: nowMs,
    });
    const ceilings = effectiveCeilings({
      dailyBase: clampDailyOrderCeiling(row.maximum_daily_signal_orders),
      perSymbolBase: clampPerSymbolOrderCeiling(row.maximum_daily_orders_per_symbol),
      adaptiveEnabled: row.adaptive_order_ceilings_enabled === true,
      adaptiveMax: clampAdaptiveCeilingMax(row.adaptive_order_ceiling_max),
      adaptiveFloor: clampAdaptiveCeilingFloor(row.adaptive_order_ceiling_floor),
      health: freshness.health,
    });
    const ceilingNote = describeCeilings(ceilings, freshness.detail);
    const symbolKey = perSymbolKey(account.user_id, signal.instrument);
    const used = occupied.get(account.user_id) ?? 0;
    const usedToday = createdToday.get(account.user_id) ?? 0;
    const usedTodayThisSymbol = createdTodayPerSymbol.get(symbolKey) ?? 0;
    if (!occupancy.readable) {
      filtered += 1;
      decisions.push({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "active_order_count_unreadable",
        detail: null,
        enqueued: 0,
        filtered: 1,
      });
      continue;
    }
    if (used >= concurrentCeiling) {
      filtered += 1;
      decisions.push({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "concurrent_order_limit_reached",
        detail: `${used} of ${concurrentCeiling} automatic orders unresolved right now`,
        enqueued: 0,
        filtered: 1,
      });
      continue;
    }
    if (usedToday >= ceilings.daily) {
      filtered += 1;
      decisions.push({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "daily_order_limit_reached",
        detail: `${usedToday} of ${ceilings.daily} automatic orders created today — ${ceilingNote}`,
        enqueued: 0,
        filtered: 1,
      });
      continue;
    }
    if (usedTodayThisSymbol >= ceilings.perSymbol) {
      filtered += 1;
      decisions.push({
        user_id: account.user_id,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "instrument_daily_order_limit_reached",
        detail: `${usedTodayThisSymbol} of ${ceilings.perSymbol} automatic orders on ${signal.instrument} today — ${ceilingNote}`,
        enqueued: 0,
        filtered: 1,
      });
      continue;
    }
    occupied.set(account.user_id, used + 1);
    if (candidatePlan !== null) {
      const list = held.get(account.user_id) ?? [];
      list.push({ ...candidatePlan, deliveryId: 0, signalId: signal.id });
      held.set(account.user_id, list);
    }

    createdToday.set(account.user_id, usedToday + 1);
    createdTodayPerSymbol.set(symbolKey, usedTodayThisSymbol + 1);

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
    decisions.push({
      user_id: account.user_id,
      signal_id: signal.id,
      instrument: signal.instrument,
      grade: signal.grade,
      decision: signal.grade === "C" ? "c_grade_allowed_by_user_setting" : "enqueued",
      detail: account.mode,
      enqueued: 1,
      filtered: 0,
    });
  }

  if (rows.length === 0) {
    await recordEnqueueDecisions(db, decisions);
    return { enqueued: 0, filtered, reason: "filtered_by_user_rules" };
  }

  const { error: insertError } = await db
    .from("execution_deliveries")
    .upsert(rows, { onConflict: "user_id,signal_id,bridge_profile", ignoreDuplicates: true });
  if (insertError) {
    const failed = decisions.map((d) =>
      d.enqueued === 1
        ? { ...d, decision: "enqueue_failed", detail: insertError.message, enqueued: 0 }
        : d,
    );
    await recordEnqueueDecisions(db, failed);
    return { enqueued: 0, filtered, reason: `enqueue_failed: ${insertError.message}` };
  }
  await recordEnqueueDecisions(db, decisions);
  return { enqueued: rows.length, filtered, reason: null };
}

/**
 * Every automatic-order attempt — A+, A, B or C — must leave exactly one
 * explanation behind. `runDirectEnqueue` records a decision on each of its own
 * exits, but a throw anywhere inside it (an unreadable lifecycle view, a
 * transport failure, a broken statistic read) used to leave the ledger silent,
 * which reads as "nothing was ever attempted". This wrapper converts any such
 * throw into a recorded system decision, so an empty ledger for a published
 * setup is impossible rather than ambiguous.
 */
export async function enqueueDirectDeliveries(
  db: SupabaseClient,
  signal: DirectEnqueueSignal,
  nowMs: number = Date.now(),
): Promise<DirectEnqueueOutcome> {
  try {
    return await runDirectEnqueue(db, signal, nowMs);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordEnqueueDecisions(db, [
      {
        user_id: null,
        signal_id: signal.id,
        instrument: signal.instrument,
        grade: signal.grade,
        decision: "enqueue_attempt_failed",
        detail,
        enqueued: 0,
        filtered: 0,
      },
    ]);
    return { enqueued: 0, filtered: 0, reason: `enqueue_attempt_failed: ${detail}` };
  }
}
