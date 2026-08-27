/**
 * Pre-send revalidation. NOTHING leaves this system without passing here.
 *
 * A delivery row was enqueued at publication; by the time a worker claims it the
 * market has moved. Every gate below is re-checked against live state, and any
 * failure ends the delivery as `rejected` with a reason — no POST is attempted.
 *
 * Order is deliberately cheapest-and-most-decisive first (switches, then stored
 * state, then the broker price), so a globally disabled system never touches
 * MetaApi or DNS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_EXECUTION_POLICY,
  REVALIDATION_QUOTE_MAX_AGE_MS,
  bridgeSupportsVerifiedQuantity,
  buildBridgeOrder,
  hostAllowedForLive,
  spreadAcceptable,
  validateQuantity,
  pendingLimitSideValid,
  withinMaxAcceptableEntry,
  type EntryMode,
  type BridgeOrder,
  type ExecutionPolicy,
  type OrderQuantity,
  type RejectReason,
} from "./execution";
import { evaluateExposure, type ExposureVerdict } from "./exposure";
import { inspectUrlSyntax, validateOutboundUrl } from "./outbound-url.server";
import {
  buildCapFrame,
  evaluateEligibility,
  type EligibilitySettings,
  type EligibilitySignal,
} from "./eligibility";
import { fetchDayFrame, toEligibilitySignal, type FrameClient } from "./day-frame";
import {
  clampAutoOrderWindowMinutes,
  contextOf,
  maxAcceptableEntry,
  type Grade,
  type SignalRow,
} from "@/lib/db-types";
import { marketStatus } from "@/lib/market-hours";
import { minStopDistance, type SizingSpec } from "@/lib/broker/specs";
import { loadBrokerSpec } from "@/lib/broker/specs.server";
import { accountSpecStale, loadAccountSizingSpec } from "@/lib/accounts/specs.server";
import { resolveSizingForAccount, resolveSizingForUser } from "@/lib/sizing/service.server";
import { fetchQuote } from "@/lib/scanner/metaapi.server";
import type { BrokerQuote } from "@/lib/metaapi/market.server";
import { quoteSourceAgeMs, quoteSourceFresh, validQuoteGeometry } from "@/lib/metaapi/quote";
import type { DeliveryDestination } from "@/lib/execution/direct";
import {
  loadDirectTarget,
  refreshDirectPreflight,
  type DirectTarget,
} from "@/lib/execution/direct.server";
import { resolveBenchmarkDesignation } from "@/lib/benchmark/policy.server";
import { isAccountSizingRefusal } from "@/lib/sizing/service.server";
import {
  INSTRUMENT_NOT_APPROVED,
  describeStage,
  lifecycleAllows,
} from "@/lib/instruments/lifecycle";
import { readLifecycleView } from "@/lib/instruments/lifecycle.server";
import { normalizeOrderGeometry } from "@/lib/instruments/precision";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export interface DeliveryRow {
  id: number;
  user_id: string;
  signal_id: string;
  bridge_profile: string;
  dry_run: boolean;
  /** How many times this row has been claimed; bounds momentary-failure retries. */
  attempts?: number | null;
  /** Configuration version that authorized this delivery when it was enqueued. */
  execution_config_version?: number | null;
  /**
   * Where this delivery goes. `bridge_json` is the Prompt-13 customer bridge;
   * `metaapi_direct` submits the order to the broker ourselves (Stage 3).
   * Absent ⇒ bridge, so every pre-Stage-3 row keeps its exact behaviour.
   */
  destination_type?: DeliveryDestination | null;
  connected_account_id?: string | null;
  account_mode?: string | null;
}

export interface RevalidationRejected {
  ok: false;
  reason: RejectReason;
  detail: string | null;
}

export interface RevalidationApproved {
  ok: true;
  order: BridgeOrder;
  policy: ExecutionPolicy;
  /** Which destination was authorized. */
  destination: DeliveryDestination;
  /**
   * Effective dry-run. TRUE whenever live execution is globally disabled, the
   * global force flag is set, the user chose dry-run, or the bridge format has
   * no verified quantity contract. Dry-run still runs the full pipeline.
   */
  dryRun: boolean;
  /** Why the effective mode is dry-run, for honest settlement copy. */
  dryRunReason: string | null;
  /** Present for bridge deliveries only. */
  endpoint: { url: string; host: string; secret: string; format: "json" | "pineconnector" } | null;
  /** Present for direct broker deliveries only. */
  direct: DirectTarget | null;
  /** The authoritative quantity actually authorized, with its provenance. */
  quantity: OrderQuantity;
  /**
   * The plan the order was built from, for the direct submission path.
   *
   * `entryPrice` / `stopLoss` / `tp1` are the SUBMITTED (broker-grid) prices that
   * sizing was re-derived from. The `published*` fields keep the signal's own
   * prices so reconciliation can explain any snap (Phase A2A, R2-FIX).
   */
  plan: {
    signalId: string;
    instrument: string;
    direction: string;
    grade: string;
    detectedAt: string;
    entryPrice: number;
    stopLoss: number;
    tp1: number;
    publishedEntryPrice: number;
    publishedStopLoss: number;
    publishedTp1: number;
    priceGridTick: number | null;
    priceGridSource: "tick_size" | "point" | "unnormalized";
    priceGridMoved: boolean;
    /** How the order reaches the market: a resting limit, or market entry. */
    entryMode: EntryMode;
  };
  /** Always reported; only blocks when the user opted in. */
  exposure: ExposureVerdict | null;
  /**
   * Operator-owned benchmark risk percentage. Present ONLY for benchmark
   * deliveries, so the benchmark record can never be sized by a customer's risk
   * profile. Null ⇒ the account owner's own risk percentage applies.
   */
  riskPercentOverride: number | null;
}

export type Revalidation = RevalidationApproved | RevalidationRejected;

/**
 * The live-execution confirmation is only valid when it was given explicitly,
 * for the CURRENT configuration version, and at a time when live execution was
 * genuinely available system-wide.
 */
export function liveConfirmationValid(
  settings: {
    live_execution_confirmed_at?: string | null;
    live_execution_confirmed_version?: number | null;
    live_execution_confirmed_global_live?: boolean | null;
  },
  currentVersion: number | null,
): boolean {
  if (!settings.live_execution_confirmed_at) return false;
  if (settings.live_execution_confirmed_global_live !== true) return false;
  if (currentVersion === null) return false;
  return settings.live_execution_confirmed_version === currentVersion;
}

function reject(reason: RejectReason, detail: string | null = null): RevalidationRejected {
  return { ok: false, reason, detail };
}

interface ControlsRow {
  live_execution_enabled: boolean | null;
  force_dry_run: boolean | null;
  disabled_bridges: string[] | null;
  disabled_instruments: string[] | null;
  allowed_live_hosts: string[] | null;
  execution_policy: string | null;
  /** Stage-3 mode gates. Absent ⇒ disabled. */
  demo_auto_enabled?: boolean | null;
  live_auto_enabled?: boolean | null;
}

interface SettingsRow {
  instruments: string[] | null;
  sessions: string[] | null;
  alert_min_grade: string | null;
  daily_setup_cap: number | null;
  execution_enabled: boolean | null;
  execution_dry_run: boolean | null;
  execution_config_version: number | null;
  exposure_limit_enabled: boolean | null;
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_format: string | null;
  webhook_validated_at: string | null;
  /** Owner's automatic-order window in minutes (0–360). */
  auto_order_window_minutes?: number | null;
  /** Owner opt-in: prefer immediate market entry inside the published ceiling. */
  auto_market_entry_enabled?: boolean | null;
  /** Explicit owner confirmation of the dry-run → live transition. */
  live_execution_confirmed_at?: string | null;
  live_execution_confirmed_version?: number | null;
  live_execution_confirmed_global_live?: boolean | null;
}

export async function revalidateDelivery(
  db: Db,
  delivery: DeliveryRow,
  now = Date.now(),
): Promise<Revalidation> {
  // ---- 1. Global switches. Unreadable controls fail closed. -----------------
  const destination: DeliveryDestination =
    delivery.destination_type === "metaapi_direct" ? "metaapi_direct" : "bridge_json";

  const { data: controlsRow, error: controlsError } = await db
    .from("execution_controls")
    .select(
      "live_execution_enabled, force_dry_run, disabled_bridges, disabled_instruments, allowed_live_hosts, execution_policy, demo_auto_enabled, live_auto_enabled",
    )
    .maybeSingle();
  if (controlsError || !controlsRow) {
    return reject("live_execution_globally_disabled", "execution controls unreadable");
  }
  const controls = controlsRow as ControlsRow;
  // Read once per delivery so the instrument gate below and any diagnostic copy
  // agree. A degraded read reports enforcement OFF, which preserves Wave 0.
  const lifecycle = await readLifecycleView(db as unknown as SupabaseClient);
  // A globally disabled system must not POST — but it MUST still be able to
  // validate end to end. `live_execution_enabled = false` therefore forces
  // dry-run rather than aborting the pipeline. Unreadable controls above still
  // fail closed, because then we cannot prove which mode is authorized.
  const globallyLive = controls.live_execution_enabled === true;
  if ((controls.disabled_bridges ?? []).includes(delivery.bridge_profile)) {
    return reject("bridge_disabled", delivery.bridge_profile);
  }
  const policy = (controls.execution_policy ?? DEFAULT_EXECUTION_POLICY) as ExecutionPolicy;
  if (policy !== DEFAULT_EXECUTION_POLICY) return reject("policy_unsupported", policy);

  // ---- 2. The user's own opt-in and bridge configuration --------------------
  const { data: settingsRow } = await db
    .from("scanner_settings")
    .select(
      "instruments, sessions, alert_min_grade, daily_setup_cap, execution_enabled, execution_dry_run, execution_config_version, exposure_limit_enabled, webhook_enabled, webhook_url, webhook_secret, webhook_format, webhook_validated_at, auto_order_window_minutes, auto_market_entry_enabled, live_execution_confirmed_at, live_execution_confirmed_version, live_execution_confirmed_global_live",
    )
    .eq("user_id", delivery.user_id)
    .maybeSingle();

  // ---- 2a. Benchmark deliveries are governed by the OPERATOR policy --------
  // The benchmark account exists to produce one honest broker-verified record of
  // the published strategy. It therefore reads NOTHING from a customer's
  // scanner_settings: instruments, minimum grade, daily cap, dry-run and risk
  // percentage all come from the persisted, versioned benchmark policy. Two
  // customers changing their preferences cannot alter a single benchmark order.
  const isBenchmark = delivery.bridge_profile.startsWith("benchmark:");
  let benchmarkRiskPercent: number | null = null;
  let settings = settingsRow as SettingsRow | null;

  if (isBenchmark) {
    const designation = await resolveBenchmarkDesignation(db);
    if (!designation.ok || !designation.policy) {
      return reject(
        "user_execution_disabled",
        designation.reason ?? "benchmark execution is unavailable",
      );
    }
    const policyRow = designation.policy;
    if (policyRow.riskPercent === null || !(policyRow.riskPercent > 0)) {
      return reject(
        "user_execution_disabled",
        "the benchmark policy has no risk percentage, so benchmark execution is unavailable",
      );
    }
    if (!delivery.connected_account_id || delivery.connected_account_id !== designation.accountId) {
      return reject(
        "account_not_armed",
        "this delivery does not name the designated benchmark account",
      );
    }
    benchmarkRiskPercent = policyRow.riskPercent;
    settings = {
      instruments: policyRow.instruments,
      // The benchmark trades the published strategy in every session it is
      // published in; a customer's session filter is not part of the record.
      sessions: [],
      alert_min_grade: policyRow.minGrade,
      daily_setup_cap: policyRow.dailyOrderCap ?? 0,
      execution_enabled: true,
      execution_dry_run: policyRow.dryRun,
      // A benchmark delivery is authorised by the POLICY version it was enqueued
      // under, never by a customer's execution configuration version.
      execution_config_version: policyRow.policyVersion,
      exposure_limit_enabled: false,
      // A benchmark order is the published pending-limit record; market entry is
      // a customer preference and is never applied to it.
      auto_market_entry_enabled: false,
      webhook_enabled: false,
      webhook_url: null,
      webhook_secret: null,
      webhook_format: null,
      webhook_validated_at: null,
    };
  }

  if (!settings) return reject("user_execution_disabled");
  // A DIRECT delivery is authorized by the ACCOUNT's armed mode, not by the
  // customer-bridge switches: it never touches a webhook, so requiring bridge
  // configuration for it would be meaningless. Bridge deliveries are unchanged.
  if (destination === "bridge_json") {
    if (settings.execution_enabled !== true) return reject("user_execution_disabled");
    if (settings.webhook_enabled !== true || !settings.webhook_url?.trim()) {
      return reject("webhook_not_configured");
    }
    if (!settings.webhook_validated_at) return reject("webhook_not_validated");
  } else if (!delivery.connected_account_id) {
    return reject("user_execution_disabled", "the delivery names no broker account");
  }

  // ---- 2b. Configuration identity binding ----------------------------------
  // A delivery is authorized by the configuration that existed when it was
  // enqueued. If the destination, format, secret identity, dry/live
  // authorization or any quantity-determining risk input has changed since, the
  // queued order is NOT re-authorized under the new configuration.
  const queuedVersion = delivery.execution_config_version ?? null;
  const currentVersion = settings.execution_config_version ?? null;
  if (queuedVersion === null || currentVersion === null) {
    return reject(
      "configuration_changed_since_enqueue",
      "no configuration version was recorded for this delivery",
    );
  }
  if (queuedVersion !== currentVersion) {
    return reject(
      "configuration_changed_since_enqueue",
      `queued under configuration v${queuedVersion}, current is v${currentVersion}`,
    );
  }

  // ---- 3. The setup itself -------------------------------------------------
  const { data: signalRow } = await db
    .from("scanned_signals")
    .select(
      "id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, max_r, max_acceptable_entry, rr_ratio, confidence_score, status, market_context(trading_session)",
    )
    .eq("id", delivery.signal_id)
    .maybeSingle();
  if (!signalRow) return reject("signal_missing");
  const signal = signalRow as unknown as SignalRow;
  if (signal.status !== "active") return reject("signal_not_active", signal.status);
  if ((controls.disabled_instruments ?? []).includes(signal.instrument)) {
    return reject("instrument_disabled", signal.instrument);
  }

  /**
   * Lifecycle execution gate — the LAST word before an order is built.
   *
   * Only `execution_approved` may reach a broker. A pair at `signals_only` is
   * publishable and alertable but must never be auto-traded, and `suspended`
   * revokes execution instantly for a pair that was approved yesterday. This gate
   * is here rather than only at enqueue time because a delivery already sitting
   * in the queue must respect a suspension decided after it was enqueued.
   *
   * `lifecycleAllows` — not `view.enforced` — is the authority, so an UNREADABLE
   * stage refuses everything outside the frozen Wave 0 universe instead of
   * silently degrading to "allowed" (Phase A2A, R3-FIX).
   */
  {
    const gate = lifecycleAllows(lifecycle, signal.instrument, "execute");
    if (!gate.allowed) {
      return reject(
        INSTRUMENT_NOT_APPROVED,
        lifecycle.degraded
          ? `the lifecycle stage for ${signal.instrument} could not be read`
          : `${signal.instrument} is at lifecycle stage "${gate.stage}" (${describeStage(gate.stage)})`,
      );
    }
  }

  // The automatic-order window the OWNER configured (benchmark deliveries fall
  // back to the default). A window of 0 means no automatic order is placed on age
  // grounds at all. This is the final age gate before an order is built.
  const autoWindowMinutes = clampAutoOrderWindowMinutes(settings.auto_order_window_minutes);
  const ageMs = now - new Date(signal.detected_at).getTime();
  if (autoWindowMinutes === 0) {
    return reject("tif_expired", "the automatic-order window is set to 0 minutes");
  }
  if (ageMs > autoWindowMinutes * 60_000) {
    return reject(
      "tif_expired",
      `${Math.round(ageMs / 60_000)} minutes old, window ${autoWindowMinutes} minutes`,
    );
  }

  // ---- 4. Canonical Prompt-10 alert eligibility -----------------------------
  // Execution is strictly narrower than alerting: a setup the user would not
  // even be told about must never be sent to their broker bridge.
  const alertGrade = (settings.alert_min_grade ?? "B") as Grade;
  const eligibilitySettings: EligibilitySettings = {
    instruments: settings.instruments ?? [],
    sessions: settings.sessions ?? [],
    min_grade: alertGrade,
    alert_min_grade: alertGrade,
    daily_setup_cap: settings.daily_setup_cap ?? 0,
  };
  const target: EligibilitySignal = toEligibilitySignal({
    id: signal.id,
    detected_at: signal.detected_at,
    instrument: signal.instrument,
    grade: signal.grade,
    market_context: contextOf(signal) ? [contextOf(signal)!] : null,
  } as unknown as SignalRow);
  let frame: EligibilitySignal[];
  try {
    const fetched = await fetchDayFrame(db as unknown as FrameClient, now);
    frame = fetched.some((s) => s.id === target.id) ? fetched : [...fetched, target];
  } catch {
    // Unlike the alert channel, execution fails CLOSED on an unreadable frame:
    // we cannot prove the user's daily cap is respected, so we do not trade.
    return reject("not_alert_eligible", "eligibility frame unreadable");
  }
  const verdict = evaluateEligibility({
    signal: target,
    settings: eligibilitySettings,
    channel: "alert",
    now,
    cappedOutIds: buildCapFrame(frame, eligibilitySettings, "alert", now),
  });
  if (!verdict.eligible) return reject("not_alert_eligible", verdict.reason);

  // ---- 5. Market state -----------------------------------------------------
  const market = marketStatus(new Date(now));
  if (market.weekendClosed || market.openCount === 0) return reject("market_closed");

  // The planned geometry. The ORDER is only assembled once an authoritative
  // quantity exists, so a BridgeOrder can never exist without one.
  const plan = {
    id: signal.id,
    instrument: signal.instrument,
    grade: signal.grade,
    direction: signal.direction,
    entryPrice: Number(signal.entry_price),
    maxAcceptableEntry: maxAcceptableEntry(signal),
    stopLoss: Number(signal.stop_loss),
    tp1: Number(signal.tp1),
    tp2: Number(signal.tp2),
    tp3: signal.tp3 === null ? null : Number(signal.tp3),
    rrRatio: Number(signal.rr_ratio),
    confidence: Number(signal.confidence_score),
  };
  const planDirection: "long" | "short" = signal.direction === "long" ? "long" : "short";
  const action: "buy_limit" | "sell_limit" = planDirection === "long" ? "buy_limit" : "sell_limit";

  // ---- 5b. Direct destination: resolve and gate the ACCOUNT first ----------
  // The destination account decides the specification, the equity and the
  // authorisation, so it is resolved before any sizing happens.
  let directTarget: DirectTarget | null = null;
  if (destination === "metaapi_direct") {
    const resolvedTarget = await loadDirectTarget(db, {
      connectedAccountId: delivery.connected_account_id as string,
      userId: delivery.user_id,
      instrument: signal.instrument,
      globalDemoAuto: controls.demo_auto_enabled === true,
      globalLiveAuto: controls.live_auto_enabled === true,
    });
    if (!resolvedTarget.ok) return reject("account_not_armed", resolvedTarget.detail);
    directTarget = resolvedTarget.target;

    // A LIVE destination additionally needs a confirmation that is still bound
    // to the CURRENT configuration and was given while live execution was
    // genuinely available. A stale authorisation is never reused.
    if (directTarget.mode === "live_auto" || directTarget.mode === "live_confirm") {
      if (!globallyLive) {
        return reject("live_execution_globally_disabled", "live execution is disabled system-wide");
      }
      if (!liveConfirmationValid(settings, currentVersion)) {
        return reject("live_authorization_stale", `configuration v${currentVersion}`);
      }
    }
  }

  // ---- 5c. Fresh broker preflight ------------------------------------------
  // A direct order must be sized and price-checked from the destination account,
  // not from an old database snapshot or the scanner's benchmark account. The
  // two independent GETs run together to stay inside the bounded dispatch pass.
  let quote: BrokerQuote | null = null;
  let quoteFailure: string | null = null;
  if (directTarget) {
    const preflight = await refreshDirectPreflight(db, directTarget);
    if (!preflight.ok) return reject(preflight.reason, preflight.detail);
    directTarget = preflight.target;
    quote = preflight.quote;
  } else {
    try {
      quote = await fetchQuote(signal.instrument);
    } catch (err) {
      quoteFailure = err instanceof Error ? err.message : String(err);
    }
  }
  if (!quote) return reject("quote_unavailable", quoteFailure ?? "broker returned no price");
  if (!validQuoteGeometry(quote.bid, quote.ask)) {
    return reject("quote_unavailable", "invalid or crossed broker quote");
  }
  // Fail closed on a missing or unparseable broker timestamp: receipt time is
  // not source time, and a fabricated age could back a live order.
  const sourceAgeMs = quoteSourceAgeMs(quote.sourceTime, now);
  if (sourceAgeMs === null) return reject("quote_stale", "no broker source timestamp");
  if (!quoteSourceFresh(quote.sourceTime, REVALIDATION_QUOTE_MAX_AGE_MS, now)) {
    return reject(
      "quote_stale",
      sourceAgeMs < 0
        ? `${Math.round(Math.abs(sourceAgeMs) / 1000)}s ahead of server clock`
        : `${Math.round(sourceAgeMs / 1000)}s old`,
    );
  }
  if (
    !spreadAcceptable({ entry: plan.entryPrice, stopLoss: plan.stopLoss }, quote.bid, quote.ask)
  ) {
    return reject("spread_too_wide");
  }

  // A pending limit is validated on its own terms: the market must still be on
  // the far side of the planned entry. The broker's minimum distance is loaded
  // below, so this first pass asserts the side only.
  const marketPrice = action === "buy_limit" ? quote.ask : quote.bid;

  /**
   * Entry mode. The owner's explicit opt-in means immediate MARKET entry for a
   * qualifying setup, even when a pending limit could technically rest. The
   * published maximum acceptable entry remains absolute; opting in never widens
   * the setup or bypasses any sizing, spread, margin or account gate below.
   */
  const marketEntryAllowed = settings.auto_market_entry_enabled === true;
  let entryMode: EntryMode = marketEntryAllowed ? "market" : "pending_limit";
  if (marketEntryAllowed) {
    if (
      !withinMaxAcceptableEntry(
        { action, maxAcceptableEntry: plan.maxAcceptableEntry },
        marketPrice,
      )
    ) {
      return reject(
        "price_beyond_max_acceptable_entry",
        `market ${marketPrice} vs ceiling ${plan.maxAcceptableEntry}`,
      );
    }
  } else if (!pendingLimitSideValid({ action, entry: plan.entryPrice }, marketPrice)) {
      return reject(
        "limit_price_not_on_pending_side",
        `market ${marketPrice} vs ${plan.entryPrice}`,
      );
  }

  // ---- 6. Broker stop distance + sizing guardrails --------------------------
  // A direct order is validated against the DESTINATION account's own
  // specification; the benchmark broker's table is never substituted for it.
  const spec: SizingSpec | null = directTarget
    ? await loadAccountSizingSpec(db, directTarget.accountId, signal.instrument)
    : await loadBrokerSpec(db, signal.instrument);
  if (directTarget) {
    if (!spec) {
      return reject(
        "account_spec_unavailable",
        `no contract specification is stored for ${signal.instrument} on this account`,
      );
    }
    if (accountSpecStale(spec, now)) {
      return reject("account_spec_unavailable", `specification as of ${spec.asOf ?? "unknown"}`);
    }
    if (directTarget.equity === null || !(directTarget.equity > 0)) {
      return reject("account_equity_unavailable");
    }
  }
  // ---- 6a. Broker price grid (Phase A2A, R2-FIX) ---------------------------
  // Every price that can reach a broker is snapped onto that broker's own tick
  // grid BY ROLE before anything is derived from it, and every downstream check —
  // stops level, risk-per-unit, quantity, margin, the order itself and the
  // approved plan — uses the SNAPPED geometry. Sizing a plan at one price and
  // submitting another is how a "1% risk" order becomes something else.
  // A market order is sized from the price it would actually fill at, not from a
  // planned entry the market has already left behind: the real stop distance is
  // wider, so the resulting volume is smaller. Never the other way round.
  const geometryEntry = entryMode === "market" ? marketPrice : plan.entryPrice;
  const submitted = normalizeOrderGeometry({
    spec,
    direction: planDirection,
    entryPrice: geometryEntry,
    stopLoss: plan.stopLoss,
    tp1: plan.tp1,
    tp2: plan.tp2,
    tp3: plan.tp3,
  });
  // A real broker destination without a known grid is refused rather than sent
  // an off-grid price: we cannot prove the order would be accepted, and we will
  // not invent a tick size.
  if (destination === "metaapi_direct" && submitted.tick === null) {
    return reject(
      "no_execution_grid",
      `no tick size or point is stored for ${signal.instrument} on this account`,
    );
  }
  const execPlan = {
    ...plan,
    entryPrice: submitted.entryPrice,
    stopLoss: submitted.stopLoss,
    tp1: submitted.tp1,
    tp2: submitted.tp2,
    tp3: submitted.tp3,
  };

  if (spec) {
    const minDistance = minStopDistance(spec);
    if (minDistance !== null && Math.abs(execPlan.entryPrice - execPlan.stopLoss) < minDistance) {
      return reject("stop_below_broker_stops_level", String(minDistance));
    }
  }

  // ---- 6a-bis. Re-check the market gates on SUBMITTED geometry -------------
  // The spread and slippage-ceiling gates in section 5 ran on the PUBLISHED
  // prices, because the destination account's specification — and therefore the
  // tick grid — is not known until section 6. Snapping changes the risk distance
  // that spread acceptability is measured against, so both gates are re-asked
  // here against the geometry that will actually be submitted. Neither check is
  // relaxed: whichever geometry fails, the delivery is refused.
  if (
    !spreadAcceptable(
      { entry: execPlan.entryPrice, stopLoss: execPlan.stopLoss },
      quote.bid,
      quote.ask,
    )
  ) {
    return reject("spread_too_wide", "measured against the submitted broker-grid geometry");
  }
  // The pending-limit side is re-asked on the snapped entry, now WITH the
  // broker's own minimum order distance. A direct broker destination whose
  // minimum distance cannot be read is refused rather than sent a price we cannot
  // prove is placeable: the distance is never assumed.
  const rawDistance = spec ? minStopDistance(spec) : null;
  const limitDistance =
    rawDistance !== null && Number.isFinite(rawDistance) && rawDistance >= 0 ? rawDistance : null;
  if (entryMode === "market") {
    // Market entry has no resting price, so the minimum ORDER distance does not
    // apply; the slippage ceiling is re-asked on the snapped ceiling instead.
    if (
      !withinMaxAcceptableEntry(
        { action, maxAcceptableEntry: execPlan.maxAcceptableEntry },
        marketPrice,
      )
    ) {
      return reject(
        "price_beyond_max_acceptable_entry",
        `market ${marketPrice} vs ceiling ${execPlan.maxAcceptableEntry}`,
      );
    }
  } else if (destination === "metaapi_direct" && limitDistance === null) {
    return reject(
      "limit_distance_unavailable",
      `no minimum order distance is stored for ${signal.instrument} on this account`,
    );
  }
  if (
    entryMode === "pending_limit" &&
    !pendingLimitSideValid({ action, entry: execPlan.entryPrice }, marketPrice, limitDistance ?? 0)
  ) {
    return reject(
      "limit_price_not_on_pending_side",
      `market ${marketPrice} vs ${execPlan.entryPrice}${
        limitDistance === null ? "" : ` (broker minimum distance ${limitDistance})`
      }`,
    );
  }

  const sizingRequest = {
    instrument: signal.instrument,
    entryPrice: execPlan.entryPrice,
    stopLoss: execPlan.stopLoss,
    signalId: signal.id,
  };
  const sizing = directTarget
    ? await resolveSizingForAccount(
        db,
        delivery.user_id,
        {
          id: directTarget.accountId,
          equity: directTarget.equity,
          currency: directTarget.currency,
          equityAsOf: directTarget.observedAt,
        },
        sizingRequest,
        now,
        { riskPercent: benchmarkRiskPercent },
      )
    : await resolveSizingForUser(db, delivery.user_id, sizingRequest, now);
  // Fail-closed broker inputs surface as themselves, never as a generic
  // guardrail: a missing account currency is not a risk decision.
  if (isAccountSizingRefusal(sizing)) {
    return reject(sizing.accountReason, sizing.detail);
  }
  if (!sizing.available) return reject("risk_guardrail", sizing.reason);
  if (sizing.belowMinimumLot || sizing.exceedsMargin || sizing.exceedsStopCeiling) {
    return reject(
      "risk_guardrail",
      sizing.belowMinimumLot
        ? "below broker minimum lot"
        : sizing.exceedsMargin
          ? "margin estimate exceeds equity"
          : "stop exceeds your stop-loss ceiling",
    );
  }

  // ---- 6b. The authoritative quantity -------------------------------------
  // The volume that goes on the order is the Prompt-12 AUTHORITATIVE sizing
  // result — never a default, never a rounded guess.
  const quantityCheck = validateQuantity(sizing.lots, {
    minLot: spec?.minLot ?? null,
    maxLot: spec?.maxLot ?? null,
    lotStep: spec?.lotStep ?? null,
    volumeCap: sizing.brokerVolumeCap,
  });
  if (!quantityCheck.ok) return reject("quantity_unavailable", quantityCheck.detail);
  const quantity: OrderQuantity = {
    lots: sizing.lots,
    sizingModel: sizing.provenance.authoritativeModel,
    specSource: sizing.provenance.specSource,
    specAsOf: sizing.provenance.specAsOf,
  };

  // ---- 6c. Journal-derived exposure: advisory unless opted in --------------
  let exposure: ExposureVerdict | null = null;
  if (sizing.advisory) {
    exposure = evaluateExposure(
      {
        openRiskR: sizing.advisory.openRiskR,
        pendingRiskR: sizing.advisory.pendingRiskR,
        realizedLossTodayR: sizing.advisory.realizedLossTodayR,
      },
      1,
      { enforce: settings.exposure_limit_enabled === true },
    );
    if (!exposure.allowed) return reject("exposure_guardrail", exposure.detail);
    if (exposure.exceeded) {
      console.warn("[revalidate] advisory exposure exceeded (not blocking)", {
        deliveryId: delivery.id,
        detail: exposure.detail,
      });
    }
  }

  // The order carries the SNAPPED geometry; the approved plan records both, so a
  // later reconciliation can explain any difference between the published signal
  // and what the broker was actually asked for.
  const order = buildBridgeOrder(execPlan, quantity, policy, autoWindowMinutes, entryMode);
  const approvedPlan = {
    signalId: signal.id,
    instrument: signal.instrument,
    direction: String(signal.direction),
    grade: String(signal.grade),
    detectedAt: signal.detected_at,
    entryPrice: execPlan.entryPrice,
    stopLoss: execPlan.stopLoss,
    tp1: execPlan.tp1,
    publishedEntryPrice: plan.entryPrice,
    publishedStopLoss: plan.stopLoss,
    publishedTp1: plan.tp1,
    priceGridTick: submitted.tick,
    priceGridSource: submitted.source,
    priceGridMoved: submitted.moved,
    entryMode,
  };

  // ---- 7a. Direct broker destination ---------------------------------------
  // No endpoint, no signature, no allowlist: the destination is the broker
  // itself through MetaApi, and authorization comes from the ACCOUNT's armed
  // mode plus the matching system-wide gate. Both default OFF.
  if (destination === "metaapi_direct" && directTarget) {
    // The only dry-run levers on the direct path are the operator's global
    // force flag and the queued row's own flag. There is no "verified quantity
    // contract" question: we construct the order ourselves.
    let directDryReason: string | null = null;
    if (controls.force_dry_run === true) directDryReason = "dry-run is forced system-wide";
    else if (delivery.dry_run === true) directDryReason = "this delivery was queued as dry-run";

    return {
      ok: true,
      order,
      policy,
      destination,
      dryRun: directDryReason !== null,
      dryRunReason: directDryReason,
      endpoint: null,
      direct: directTarget,
      quantity,
      plan: approvedPlan,
      exposure,
      riskPercentOverride: benchmarkRiskPercent,
    };
  }

  // ---- 7b. Endpoint validation (customer bridge) ---------------------------
  const webhookUrl = settings.webhook_url?.trim() ?? "";
  if (!webhookUrl) return reject("webhook_not_configured");
  const syntax = inspectUrlSyntax(webhookUrl);
  if (!syntax.ok) return reject("endpoint_rejected", syntax.reason);
  const resolved = await validateOutboundUrl(webhookUrl);
  if (!resolved.ok) return reject("endpoint_rejected", resolved.reason);

  const secret = settings.webhook_secret?.trim() ?? "";
  const format = settings.webhook_format === "pineconnector" ? "pineconnector" : "json";
  if (!secret) return reject("webhook_not_configured", "no bridge secret / licence id");

  // Effective mode is the SAFE union of every switch, plus the bridge's own
  // capability: a format whose quantity syntax we have not verified against the
  // receiver contract is dry-run-only rather than sent with a guessed volume.
  let dryRunReason: string | null = null;
  if (!globallyLive) dryRunReason = "live execution is disabled system-wide";
  else if (controls.force_dry_run === true) dryRunReason = "dry-run is forced system-wide";
  else if (delivery.dry_run === true) dryRunReason = "you selected dry-run";
  else if (!bridgeSupportsVerifiedQuantity(format)) {
    dryRunReason = `the ${format} bridge has no verified quantity contract, so automatic live orders are not sent to it`;
  } else if (!liveConfirmationValid(settings, currentVersion)) {
    // A live POST requires a FRESH, explicit owner confirmation given for this
    // exact configuration while live execution was actually available. A
    // previously stored dry-run preference can therefore never become live just
    // because an operator flipped the global switch afterwards.
    dryRunReason =
      "live execution has not been confirmed for this configuration, so no live order is sent";
  }
  const dryRun = dryRunReason !== null;

  // A LIVE order may only leave to an operator-listed destination. Dry-run is
  // unrestricted, so any bridge can still be fully validated end to end.
  if (!dryRun && !hostAllowedForLive(resolved.host, controls.allowed_live_hosts ?? [])) {
    return reject("host_not_allowlisted", resolved.host);
  }

  return {
    ok: true,
    order,
    policy,
    destination,
    dryRun,
    dryRunReason,
    endpoint: { url: resolved.url, host: resolved.host, secret, format },
    direct: null,
    quantity,
    plan: approvedPlan,
    exposure,
    riskPercentOverride: null,
  };
}
