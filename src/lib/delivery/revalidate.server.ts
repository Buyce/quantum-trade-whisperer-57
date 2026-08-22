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
  buildBridgeOrder,
  spreadAcceptable,
  withinMaxAcceptableEntry,
  type BridgeOrder,
  type ExecutionPolicy,
  type RejectReason,
} from "./execution";
import { evaluateExposure } from "./exposure";
import { inspectUrlSyntax, validateOutboundUrl } from "./outbound-url.server";
import {
  buildCapFrame,
  evaluateEligibility,
  type EligibilitySettings,
  type EligibilitySignal,
} from "./eligibility";
import { fetchDayFrame, toEligibilitySignal, type FrameClient } from "./day-frame";
import { ORDER_TIF_MINUTES, contextOf, maxAcceptableEntry, type Grade, type SignalRow } from "@/lib/db-types";
import { marketStatus } from "@/lib/market-hours";
import { minStopDistance } from "@/lib/broker/specs";
import { loadBrokerSpec } from "@/lib/broker/specs.server";
import { resolveSizingForUser } from "@/lib/sizing/service.server";
import { fetchQuote } from "@/lib/scanner/metaapi.server";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export interface DeliveryRow {
  id: number;
  user_id: string;
  signal_id: string;
  bridge_profile: string;
  dry_run: boolean;
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
  /** Effective dry-run: the union of the global force flag and the user's choice. */
  dryRun: boolean;
  endpoint: { url: string; host: string; secret: string; format: "json" | "pineconnector" };
}

export type Revalidation = RevalidationApproved | RevalidationRejected;

function reject(reason: RejectReason, detail: string | null = null): RevalidationRejected {
  return { ok: false, reason, detail };
}

interface ControlsRow {
  live_execution_enabled: boolean | null;
  force_dry_run: boolean | null;
  disabled_bridges: string[] | null;
  disabled_instruments: string[] | null;
  execution_policy: string | null;
}

interface SettingsRow {
  instruments: string[] | null;
  sessions: string[] | null;
  alert_min_grade: string | null;
  daily_setup_cap: number | null;
  execution_enabled: boolean | null;
  execution_dry_run: boolean | null;
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_format: string | null;
  webhook_validated_at: string | null;
}

export async function revalidateDelivery(
  db: Db,
  delivery: DeliveryRow,
  now = Date.now(),
): Promise<Revalidation> {
  // ---- 1. Global switches. Unreadable controls fail closed. -----------------
  const { data: controlsRow, error: controlsError } = await db
    .from("execution_controls")
    .select(
      "live_execution_enabled, force_dry_run, disabled_bridges, disabled_instruments, execution_policy",
    )
    .maybeSingle();
  if (controlsError || !controlsRow) {
    return reject("live_execution_globally_disabled", "execution controls unreadable");
  }
  const controls = controlsRow as ControlsRow;
  if (controls.live_execution_enabled !== true) {
    return reject("live_execution_globally_disabled");
  }
  if ((controls.disabled_bridges ?? []).includes(delivery.bridge_profile)) {
    return reject("bridge_disabled", delivery.bridge_profile);
  }
  const policy = (controls.execution_policy ?? DEFAULT_EXECUTION_POLICY) as ExecutionPolicy;
  if (policy !== DEFAULT_EXECUTION_POLICY) return reject("policy_unsupported", policy);

  // ---- 2. The user's own opt-in and bridge configuration --------------------
  const { data: settingsRow } = await db
    .from("scanner_settings")
    .select(
      "instruments, sessions, alert_min_grade, daily_setup_cap, execution_enabled, execution_dry_run, webhook_enabled, webhook_url, webhook_secret, webhook_format, webhook_validated_at",
    )
    .eq("user_id", delivery.user_id)
    .maybeSingle();
  const settings = settingsRow as SettingsRow | null;
  if (!settings || settings.execution_enabled !== true) return reject("user_execution_disabled");
  if (settings.webhook_enabled !== true || !settings.webhook_url?.trim()) {
    return reject("webhook_not_configured");
  }
  if (!settings.webhook_validated_at) return reject("webhook_not_validated");

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

  const ageMs = now - new Date(signal.detected_at).getTime();
  if (ageMs > ORDER_TIF_MINUTES * 60_000) {
    return reject("tif_expired", `${Math.round(ageMs / 60_000)} minutes old`);
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

  const order = buildBridgeOrder(
    {
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
    },
    policy,
  );

  let quote: Awaited<ReturnType<typeof fetchQuote>> = null;
  try {
    quote = await fetchQuote(signal.instrument);
  } catch {
    quote = null;
  }
  if (!quote) return reject("quote_unavailable");
  // Fail closed on a missing or unparseable broker timestamp: receipt time is
  // not source time, and a fabricated age could back a live order.
  const sourceMs = quote.sourceTime ? Date.parse(quote.sourceTime) : Number.NaN;
  if (!Number.isFinite(sourceMs)) return reject("quote_stale", "no broker source timestamp");
  if (now - sourceMs > REVALIDATION_QUOTE_MAX_AGE_MS) {
    return reject("quote_stale", `${Math.round((now - sourceMs) / 1000)}s old`);
  }
  if (!spreadAcceptable(order, quote.bid, quote.ask)) return reject("spread_too_wide");

  const marketPrice = order.action === "buy_limit" ? quote.ask : quote.bid;
  if (!withinMaxAcceptableEntry(order, marketPrice)) {
    return reject("price_beyond_max_acceptable_entry", String(marketPrice));
  }

  // ---- 6. Broker stop distance + sizing guardrails --------------------------
  const spec = await loadBrokerSpec(db, signal.instrument);
  if (spec) {
    const minDistance = minStopDistance(spec);
    if (minDistance !== null && Math.abs(order.entry - order.stopLoss) < minDistance) {
      return reject("stop_below_broker_stops_level", String(minDistance));
    }
  }

  const sizing = await resolveSizingForUser(
    db,
    delivery.user_id,
    { instrument: signal.instrument, entryPrice: order.entry, stopLoss: order.stopLoss, signalId: signal.id },
    now,
  );
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
  if (sizing.advisory) {
    const exposure = evaluateExposure({
      openRiskR: sizing.advisory.openRiskR,
      pendingRiskR: sizing.advisory.pendingRiskR,
      realizedLossTodayR: sizing.advisory.realizedLossTodayR,
    });
    if (!exposure.allowed) return reject("exposure_guardrail", exposure.detail);
  }

  // ---- 7. Endpoint validation ---------------------------------------------
  const syntax = inspectUrlSyntax(settings.webhook_url);
  if (!syntax.ok) return reject("endpoint_rejected", syntax.reason);
  const resolved = await validateOutboundUrl(settings.webhook_url);
  if (!resolved.ok) return reject("endpoint_rejected", resolved.reason);

  const secret = settings.webhook_secret?.trim() ?? "";
  const format = settings.webhook_format === "pineconnector" ? "pineconnector" : "json";
  if (!secret) return reject("webhook_not_configured", "no bridge secret / licence id");

  return {
    ok: true,
    order,
    policy,
    // Either switch alone forces dry-run: the safe state is the union.
    dryRun: controls.force_dry_run === true || delivery.dry_run === true,
    endpoint: { url: resolved.url, host: resolved.host, secret, format },
  };
}
