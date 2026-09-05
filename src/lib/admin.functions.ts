/**
 * Owner-only intelligence read.
 *
 * Defence in depth: this handler rejects any non-owner identity before it
 * touches the database, and `public.get_admin_intelligence()` independently
 * re-checks `auth.jwt() ->> 'email'` on the SQL side. Both gates read the same
 * verified bearer token, so neither can be bypassed from the client.
 *
 * ZERO-HALLUCINATION: every field is an aggregate over live rows. Empty
 * sections come back empty and the UI says so.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import {
  aggregateAutoTraderOutcomes,
  type AutoTraderOutcomes,
} from "@/lib/admin/auto-trader-outcomes";

const OWNER_EMAIL = "boatengampomah@gmail.com";

export interface AdminEngine {
  paused: boolean;
  consecutive_failures: number;
  last_error: string | null;
  last_run_at: string | null;
}

export interface AdminInstrumentHealth {
  instrument: string;
  available: boolean;
  last_error: string | null;
  unavailable_until: string | null;
  updated_at: string;
}

export interface AdminBacklog {
  pending: number;
  processing: number;
  oldest_pending_at: string | null;
  oldest_pending_age_min: number | null;
}

export interface AdminHealth {
  last_cycle_at: string | null;
  p50_ms: number | null;
  p95_ms: number | null;
  jobs: Record<string, number>;
  results: Record<string, number>;
  backlog: AdminBacklog;
  engine: AdminEngine | null;
  instruments: AdminInstrumentHealth[];
}

export interface AdminEngagement {
  active_accounts: number;
  total_taken: number;
  total_skipped: number;
  telemetry_events: number;
  by_instrument: { instrument: string; taken: number; skipped: number }[];
  taken_performance: { n: number; mean_r: number | null; win_rate: number | null } | null;
  /** Users' own logged outcomes in Trade History — not shadow replay. */
  user_reported: {
    n: number;
    wins: number;
    mean_r: number | null;
    win_rate: number | null;
  } | null;
}

export interface AdminFillRow {
  sess: string;
  n: number;
  filled: number;
  missed: number;
  median_miss_atr: number | null;
}

export interface AdminRegimeRow {
  tier: number;
  regime_key: string;
  instrument: string | null;
  direction: string | null;
  session: string | null;
  vol_bucket: string | null;
  n_total: number;
  n_filled: number;
  wins: number;
  p_fill_raw: number | null;
  p_win_raw: number | null;
  p_fill_shrunk: number | null;
  p_win_shrunk: number | null;
  computed_at: string;
  fill_gate_pct: number;
  win_gate_pct: number;
  fill_gate_passed: boolean;
  win_gate_passed: boolean;
}

export interface AdminDisciplineSide {
  n: number;
  filled: number;
  win_rate: number | null;
  mean_r: number | null;
}

export interface AdminDiscipline {
  total_decisions: number;
  sufficient: boolean;
  taken: AdminDisciplineSide;
  skipped: AdminDisciplineSide;
}

export interface AdminWebhooks {
  total_24h: number;
  success_rate: number | null;
  p95_latency_ms: number | null;
  recent_errors: {
    created_at: string;
    signal_id: string | null;
    http_status: number | null;
    latency_ms: number | null;
    error: string | null;
  }[];
}

export interface AdminGradeRow {
  grade: string;
  n: number;
  filled: number;
  win_rate: number | null;
  mean_r: number | null;
  avg_confidence: number | null;
}

export interface AdminDedup {
  suppressed_24h: number;
  suppressed_7d: number;
  published_24h: number;
}

export interface AdminFeedRow {
  id: string;
  instrument: string;
  grade: string;
  direction: string;
  detected_at: string;
  status: string;
  confidence_score: number | null;
  trading_session: string | null;
  taken_count: number;
  skipped_count: number;
  shadow_status: string | null;
  resolved_outcome: string | null;
  realized_r: number | null;
  miss_distance_atr: number | null;
}

/**
 * Who authored the activity: a person in the web terminal (`human`) or an AI
 * assistant over the MCP connection (`agent`). Stamped server-side at write
 * time; never accepted as client input.
 */
export interface AdminAuthorSplit {
  accounts: { source: string; n: number; clients: string[] }[];
  decisions: { source: string; taken: number; skipped: number; clients: string[] }[];
  user_reported: {
    source: string;
    n: number;
    wins: number;
    win_rate: number | null;
    mean_r: number | null;
  }[];
}

export interface AdminIntelligence {
  generated_at: string;
  health: AdminHealth;
  engagement: AdminEngagement;
  fill_diagnostic: { h24: AdminFillRow[]; d7: AdminFillRow[] };
  learning_matrix: AdminRegimeRow[];
  discipline: AdminDiscipline;
  webhooks: AdminWebhooks;
  grade_calibration: AdminGradeRow[];
  dedup_pressure: AdminDedup;
  intersection_feed: AdminFeedRow[];
  author_split: AdminAuthorSplit | null;
}

/**
 * Replay-engine circuit breaker. This is the SHADOW REPLAY / statistics engine,
 * not the 15-minute scanner: the two were previously rendered under one
 * "Scan engine" tile, which read as if live scanning had stopped.
 */
export interface AdminBreaker {
  paused: boolean;
  paused_until: string | null;
  consecutive_failures: number;
  last_error: string | null;
  last_run_at: string | null;
}

/** Live scanner outcomes in the last 60 minutes, straight from `scan_queue`. */
export interface AdminScanWindow {
  window_minutes: number;
  total: number;
  failed: number;
  succeeded: number;
  last_finished_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
}

export interface AdminEngineStatus {
  generated_at: string;
  breaker: AdminBreaker | null;
  scan: AdminScanWindow;
}

export const getAdminIntelligence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminIntelligence> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) {
      throw new Error("Forbidden");
    }

    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as (
      name: string,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    const [main, split] = await Promise.all([
      rpc("get_admin_intelligence"),
      rpc("get_admin_author_split"),
    ]);
    if (main.error) throw new Error(main.error.message);
    if (split.error) throw new Error(split.error.message);

    return {
      ...(main.data as AdminIntelligence),
      author_split: (split.data as AdminAuthorSplit) ?? null,
    };
  });

/** Owner-only engine status: scanner window + replay breaker, read separately. */
export const getAdminEngineStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminEngineStatus> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as (
      name: string,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    const { data, error } = await rpc("get_admin_engine_status");
    if (error) throw new Error(error.message);
    return data as AdminEngineStatus;
  });

/**
 * Owner-only breaker reset. Clears `paused`, the failure counter and the
 * cooldown so the next hourly resolve pass runs immediately. Purely an
 * operational control: it changes no replay maths and fabricates no rows.
 */
export const resetShadowBreaker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean }> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as (
      name: string,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    const { data, error } = await rpc("admin_reset_shadow_breaker");
    if (error) throw new Error(error.message);
    return { ok: Boolean((data as { ok?: boolean } | null)?.ok) };
  });

export interface AdminExecutionSwitches {
  demoAutoEnabled: boolean;
  forceDryRun: boolean;
  liveExecutionEnabled: boolean;
  liveAutoEnabled: boolean;
  executionPolicy: string;
  /** Hosts an outbound LIVE webhook POST may be sent to. Empty = nothing may go out. */
  allowedLiveHosts: string[];
  emergencyStopEnabled: boolean;
  emergencyStopAt: string | null;
  emergencyStopReason: string | null;
  updatedAt: string | null;
}

const SWITCH_COLUMNS =
  "demo_auto_enabled, force_dry_run, live_execution_enabled, live_auto_enabled, execution_policy, allowed_live_hosts, emergency_stop_enabled, emergency_stop_at, emergency_stop_reason, updated_at";

interface SwitchRow {
  demo_auto_enabled?: boolean;
  force_dry_run?: boolean;
  live_execution_enabled?: boolean;
  live_auto_enabled?: boolean;
  execution_policy?: string;
  allowed_live_hosts?: string[] | null;
  emergency_stop_enabled?: boolean;
  emergency_stop_at?: string | null;
  emergency_stop_reason?: string | null;
  updated_at?: string;
}

/**
 * Defaults are the SAFE reading of a missing value: nothing armed, dry-run on,
 * no host allowed, emergency stop off. An unreadable control is never read as permission.
 */
function mapSwitches(row: SwitchRow | null): AdminExecutionSwitches {
  return {
    demoAutoEnabled: row?.demo_auto_enabled === true,
    forceDryRun: row?.force_dry_run !== false,
    liveExecutionEnabled: row?.live_execution_enabled === true,
    liveAutoEnabled: row?.live_auto_enabled === true,
    executionPolicy: row?.execution_policy ?? "single_exit_first_target",
    allowedLiveHosts: row?.allowed_live_hosts ?? [],
    emergencyStopEnabled: row?.emergency_stop_enabled === true,
    emergencyStopAt: row?.emergency_stop_at ?? null,
    emergencyStopReason: row?.emergency_stop_reason ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * Owner-only read of the system-wide execution capabilities.
 *
 * These are the switches that decide whether an armed account may actually
 * receive an order, and whether a webhook bridge may POST for real.
 */
export const getAdminExecutionSwitches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminExecutionSwitches> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("execution_controls")
      .select(SWITCH_COLUMNS)
      .eq("id", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return mapSwitches(data as SwitchRow | null);
  });

/**
 * Owner-only write of the system-wide execution capabilities.
 *
 * Demo switches are ordinary toggles. The LIVE switches are deliberately harder:
 *
 *  - Live execution cannot be enabled while `force_dry_run` is on or while the
 *    global emergency stop is on.
 *  - The host allow-list applies to the EXTERNAL WEBHOOK BRIDGE destination
 *    only. Direct MetaApi (MT4/MT5) execution has no operator-chosen host —
 *    its hosts come from the pinned trusted-host resolver — so an empty
 *    allow-list never blocks enabling live execution. A live bridge delivery
 *    to a non-listed host still fails closed at pre-send revalidation.
 *  - Hosts are normalised to bare lowercase hostnames and must be plain
 *    hostnames; a URL, a path, a port or a wildcard is rejected here so the
 *    allow-list can never be widened by a sloppy entry. Per-request SSRF
 *    validation at dispatch is unchanged and still authoritative.
 *  - Turning anything OFF is always accepted, with no preconditions.
 *  - Turning the emergency stop ON forces live execution and live auto OFF in
 *    the same write, and records a reason.
 */
export const setAdminExecutionSwitches = createServerFn({ method: "POST" })
  .validator(
    (input: {
      demoAutoEnabled?: boolean;
      forceDryRun?: boolean;
      liveExecutionEnabled?: boolean;
      liveAutoEnabled?: boolean;
      allowedLiveHosts?: string[];
      emergencyStopEnabled?: boolean;
      emergencyStopReason?: string;
    }) => input,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<AdminExecutionSwitches> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: currentRow, error: currentError } = await supabaseAdmin
      .from("execution_controls")
      .select(SWITCH_COLUMNS)
      .eq("id", true)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    const current = mapSwitches(currentRow as SwitchRow | null);

    const patch: Record<string, unknown> = {};
    if (typeof data.demoAutoEnabled === "boolean")
      patch["demo_auto_enabled"] = data.demoAutoEnabled;
    if (typeof data.forceDryRun === "boolean") patch["force_dry_run"] = data.forceDryRun;

    let hosts = current.allowedLiveHosts;
    if (Array.isArray(data.allowedLiveHosts)) {
      hosts = normaliseHosts(data.allowedLiveHosts);
      patch["allowed_live_hosts"] = hosts;
    }

    const dryRunAfter =
      typeof data.forceDryRun === "boolean" ? data.forceDryRun : current.forceDryRun;
    const emergencyStopAfter =
      typeof data.emergencyStopEnabled === "boolean"
        ? data.emergencyStopEnabled
        : current.emergencyStopEnabled;

    if (typeof data.emergencyStopEnabled === "boolean") {
      patch["emergency_stop_enabled"] = data.emergencyStopEnabled;
      if (data.emergencyStopEnabled) {
        patch["emergency_stop_at"] = new Date().toISOString();
        patch["emergency_stop_reason"] =
          data.emergencyStopReason?.trim() || "Owner activated emergency stop";
        // A live-armed system under emergency stop is contradictory: disarm it.
        patch["live_execution_enabled"] = false;
        patch["live_auto_enabled"] = false;
      } else {
        patch["emergency_stop_at"] = null;
        patch["emergency_stop_reason"] = null;
      }
    }

    if (typeof data.liveExecutionEnabled === "boolean") {
      if (data.liveExecutionEnabled) {
        if (dryRunAfter)
          throw new Error("Turn the system-wide dry-run lock off before enabling live execution.");
        if (emergencyStopAfter)
          throw new Error("Disable the emergency stop before enabling live execution.");
        // No host allow-list requirement here: that list gates the external
        // webhook bridge only (enforced at pre-send revalidation). Direct
        // MetaApi execution has no operator-chosen host.
      }
      patch["live_execution_enabled"] = data.liveExecutionEnabled;
    }

    if (typeof data.liveAutoEnabled === "boolean") {
      if (data.liveAutoEnabled) {
        const liveExecAfter =
          typeof data.liveExecutionEnabled === "boolean"
            ? data.liveExecutionEnabled
            : current.liveExecutionEnabled;
        if (!liveExecAfter)
          throw new Error("Enable live execution before arming automatic live orders.");
        if (emergencyStopAfter)
          throw new Error("Disable the emergency stop before arming automatic live orders.");
      }
      patch["live_auto_enabled"] = data.liveAutoEnabled;
    }

    if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");

    const { error } = await supabaseAdmin
      .from("execution_controls")
      .update(patch as never)
      .eq("id", true);
    if (error) throw new Error(error.message);

    const { data: fresh, error: readError } = await supabaseAdmin
      .from("execution_controls")
      .select(SWITCH_COLUMNS)
      .eq("id", true)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    return mapSwitches(fresh as SwitchRow | null);
  });

function normaliseHosts(input: string[]): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const host = String(raw).trim().toLowerCase();
    if (host === "") continue;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host))
      throw new Error(`"${raw}" is not a plain hostname (example: hooks.example.com).`);
    if (!out.includes(host)) out.push(host);
  }
  return out;
}

/**
 * What the dispatch queue SPENT on refusals over the last 7 days.
 *
 * Every attempt is a broker API call and a slot in a bounded worker pass, so a
 * refusal that is re-asked eighty times costs eighty times as much as one that
 * is settled. This read reports the cost per refusal reason — rows, attempts
 * spent, and how long the row sat in the queue — so waste is measured rather
 * than guessed. It reports recorded rows only; a reason absent from the ledger
 * is absent here too.
 */
export interface AdminRefusalCost {
  reason: string;
  rows: number;
  attempts: number;
  maxAttempts: number;
  medianQueueMinutes: number | null;
}

export const getAdminRefusalCost = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminRefusalCost[]> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("execution_deliveries")
      .select("reason, attempts, enqueued_at, settled_at, state")
      .in("state", ["rejected", "failed", "expired"])
      .gte("enqueued_at", since)
      .order("enqueued_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);

    const groups = new Map<
      string,
      { rows: number; attempts: number; max: number; waits: number[] }
    >();
    for (const raw of (data ?? []) as Record<string, unknown>[]) {
      // The bare reason, without its per-row numeric detail, is the unit of cost.
      const reason =
        String(raw["reason"] ?? "unrecorded")
          .split(":")[0]!
          .trim() || "unrecorded";
      const bucket = groups.get(reason) ?? { rows: 0, attempts: 0, max: 0, waits: [] };
      const attempts = Number(raw["attempts"] ?? 0);
      bucket.rows += 1;
      bucket.attempts += attempts;
      bucket.max = Math.max(bucket.max, attempts);
      const enqueued = Date.parse(String(raw["enqueued_at"] ?? ""));
      const settled = Date.parse(String(raw["settled_at"] ?? ""));
      if (Number.isFinite(enqueued) && Number.isFinite(settled) && settled >= enqueued) {
        bucket.waits.push((settled - enqueued) / 60000);
      }
      groups.set(reason, bucket);
    }

    return [...groups.entries()]
      .map(([reason, b]) => ({
        reason,
        rows: b.rows,
        attempts: b.attempts,
        maxAttempts: b.max,
        // Median, not mean: one row parked for hours must not be reported as the
        // typical wait.
        medianQueueMinutes:
          b.waits.length === 0
            ? null
            : Math.round(b.waits.sort((x, y) => x - y)[Math.floor(b.waits.length / 2)]!),
      }))
      .sort((a, b) => b.attempts - a.attempts);
  });

export interface AdminEnqueueDecision {
  at: string;
  instrument: string | null;
  grade: string | null;
  decision: string;
  detail: string | null;
  enqueued: number;
  filtered: number;
}

/**
 * Owner-only read of the most recent automatic-order decisions across all users.
 *
 * Pseudonymous by construction: user identity is never returned, because the
 * operational question is "did the engine decide, and what did it decide",
 * not "who".
 */
export const getAdminEnqueueDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminEnqueueDecision[]> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("execution_enqueue_decisions")
      .select("created_at, instrument, grade, decision, detail, enqueued, filtered")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      at: String(row["created_at"]),
      instrument: (row["instrument"] as string | null) ?? null,
      grade: (row["grade"] as string | null) ?? null,
      decision: String(row["decision"]),
      detail: (row["detail"] as string | null) ?? null,
      enqueued: Number(row["enqueued"] ?? 0),
      filtered: Number(row["filtered"] ?? 0),
    }));
  });

/**
 * Owner-only instrument/telemetry diagnostics (Phase A2 operational telemetry).
 *
 * The underlying RPC is granted to the service role ONLY, so this handler reads it
 * through the admin client after verifying the owner identity from the bearer
 * token. That is deliberate: telemetry describes provider budget consumption and
 * lifecycle stages, which no ordinary authenticated session should be able to read.
 *
 * Everything returned is an aggregate over live rows. An empty section stays empty
 * rather than being padded with an example.
 */
export type DiagnosticsRow = Record<string, Json>;

export interface AdminInstrumentDiagnostics {
  generated_at: string;
  lifecycle: DiagnosticsRow[];
  latest_readiness: DiagnosticsRow[];
  spread_stats: DiagnosticsRow[];
  sampler: DiagnosticsRow[];
  capacity: DiagnosticsRow[];
}

export const getAdminInstrumentDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminInstrumentDiagnostics> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("get_admin_instrument_diagnostics");
    if (error) throw new Error(error.message);
    return data as unknown as AdminInstrumentDiagnostics;
  });

/**
 * Owner-only commissioning view (Wave 1 / Wave 2 validation commissioning).
 *
 * One row per registry instrument: wave, lifecycle stage, provider symbol,
 * mapping and specification status, candle/quote quality, conversion readiness,
 * calendar verification, sampler coverage, valid/invalid sample counts, breaker
 * status, scan duration, provider errors, promotion blockers and the last
 * successful readiness check.
 *
 * The RPC is admin-gated in the database and returns no token, account id, login
 * or raw provider payload.
 */
export interface AdminCommissioning {
  generated_at: string;
  lifecycle_enforced: boolean | null;
  sampler_symbols: string[] | null;
  instruments: DiagnosticsRow[];
}

export const getAdminCommissioning = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminCommissioning> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("get_admin_commissioning");
    if (error) throw new Error(error.message);
    return data as unknown as AdminCommissioning;
  });

/** Telemetry control room: the current worker switches and provider ceilings. */
export interface AdminTelemetryControls {
  sampler_enabled: boolean;
  aggregation_enabled: boolean;
  retention_enabled: boolean;
  capacity_enabled: boolean;
  readiness_enabled: boolean;
  sampler_symbols: string[];
  max_instruments_per_run: number;
  max_requests_per_run: number;
  daily_request_budget: number;
  note: string | null;
  updated_at: string | null;
}

export const getAdminTelemetryControls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminTelemetryControls | null> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("telemetry_controls")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as AdminTelemetryControls) ?? null;
  });

/**
 * Live economic-event (news) diagnostics.
 *
 * Everything here is measured: ingestion runs actually attempted, coverage
 * actually proven per (provider, currency, family), events actually stored, and
 * the dark policy comparisons the engine recorded. There is no aggregate
 * "news healthy" flag, because there is no scope in which one would be truthful.
 */
export interface AdminNewsRun {
  provider: string;
  job: string;
  started_at: string;
  completed_at: string | null;
  batch_status: string;
  events_received: number;
  inserts: number;
  updates: number;
  duplicates: number;
  revisions: number;
  invalid_events: number;
  request_count: number;
  retry_count: number;
  response_status: number | null;
  duration_ms: number | null;
  error_class: string | null;
  error_note: string | null;
  worker_version: string;
}

export interface AdminNewsProviderHealth {
  provider: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  runs_24h: number;
  failures_24h: number;
}

export interface AdminNewsCoverage {
  provider: string;
  country: string | null;
  currency: string | null;
  event_family: string;
  coverage_state: string;
  scheduled_events: number;
  events_with_exact_time: number;
  latest_event_at: string | null;
  last_successful_run_at: string | null;
  freshness_seconds: number | null;
  source_version: string | null;
  mapping_version: string | null;
  note: string | null;
  computed_at: string;
}

export interface AdminNewsEvent {
  canonical_event_id: string;
  provider: string;
  event_family: string;
  currencies: string[];
  importance: string;
  scheduled_at: string | null;
  scheduled_date: string | null;
  timestamp_precision: string;
  event_status: string;
  affected_instruments: string[];
  source_version: string;
  mapping_version: string;
}

export interface AdminNewsEvaluation {
  evaluated_at: string;
  boundary: string;
  instrument: string;
  wave: number | null;
  mode: string;
  decision: string;
  coverage_state: string;
  required_currencies: string[];
  required_families: string[];
  news_snapshot_version: string;
  news_policy_version: string;
  reason: string | null;
}

export interface AdminNews {
  runs: AdminNewsRun[];
  provider_health: AdminNewsProviderHealth[];
  coverage: AdminNewsCoverage[];
  upcoming: AdminNewsEvent[];
  event_totals: {
    provider: string;
    event_family: string;
    events: number;
    exact_time_events: number;
    last_ingested_at: string | null;
  }[];
  evaluations: AdminNewsEvaluation[];
  evaluation_summary: { instrument: string; mode: string; decision: string; n: number }[];
  generated_at: string;
}

export const getAdminNews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminNews> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("get_admin_news");
    if (error) throw new Error(error.message);
    return data as unknown as AdminNews;
  });

/**
 * Owner-only promotion checkpoint (`data_validation -> shadow`).
 *
 * Reports, per registry instrument, whether the recorded evidence satisfies the
 * pure gate in `@/lib/instruments/promotion` and names every unmet criterion with
 * its measured value. It is a READ: nothing here changes a stage, and promotion
 * itself remains the audited `transition_instrument_stage` action.
 */
export const getAdminPromotionCheckpoint = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { collectPromotionCheckpoint } = await import("@/lib/instruments/promotion.server");
    return await collectPromotionCheckpoint(supabaseAdmin);
  });

/**
 * Broker-verified outcomes of the automatic trader (owner only).
 *
 * Reads CLOSED customer broker-trade evidence only: real fills, real exits and
 * broker-reported money. It is not the shadow replay and not user-reported — those
 * live in their own tiles, deliberately, because they answer different questions.
 * Grades proved from the decision log after their setup was purged are counted and
 * labelled; a trade with no recoverable grade is reported as "Unknown".
 */
export const getAdminAutoTraderOutcomes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutoTraderOutcomes> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("broker_trade_evidence")
      .select(
        "signal_grade, signal_grade_source, gross_profit, swap, commission, profit_currency, r_vs_plan",
      )
      .eq("evidence_class", "customer")
      .eq("state", "closed");
    if (error) throw new Error(error.message);

    const finite = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v)
        ? v
        : v === null
          ? null
          : Number.isFinite(Number(v))
            ? Number(v)
            : null;

    return aggregateAutoTraderOutcomes(
      (data ?? []).map((row) => {
        const gross = finite(row.gross_profit);
        return {
          grade: row.signal_grade ?? null,
          gradeSource: row.signal_grade_source ?? null,
          // Net is what the account actually moved by: gross plus financing and fees.
          netProfit:
            gross === null ? null : gross + (finite(row.swap) ?? 0) + (finite(row.commission) ?? 0),
          rVsPlan: finite(row.r_vs_plan),
          currency: row.profit_currency ?? null,
        };
      }),
    );
  });

/**
 * Platform-wide trade totals (owner only).
 *
 * Two independent counts, deliberately not merged: closed customer broker-trade
 * evidence across every connected account, and the in-app `executed_trades`
 * journal. Aggregation rules live in `@/lib/admin/trade-totals`; nothing here is
 * scoped to a single user or account.
 */
export const getAdminTradeTotals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TradeTotals> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [evidence, journal] = await Promise.all([
      supabaseAdmin
        .from("broker_trade_evidence")
        .select("connected_account_id, gross_profit, swap, commission, profit_currency")
        .eq("evidence_class", "customer")
        .eq("state", "closed"),
      supabaseAdmin.from("executed_trades").select("outcome"),
    ]);
    if (evidence.error) throw new Error(evidence.error.message);
    if (journal.error) throw new Error(journal.error.message);

    const numeric = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v)
        ? v
        : v === null || v === undefined
          ? null
          : Number.isFinite(Number(v))
            ? Number(v)
            : null;

    return {
      broker: aggregateBrokerTotals(
        (evidence.data ?? []).map((row) => ({
          accountId: row.connected_account_id ?? null,
          grossProfit: numeric(row.gross_profit),
          swap: numeric(row.swap),
          commission: numeric(row.commission),
          currency: row.profit_currency ?? null,
        })),
      ),
      journal: aggregateJournalTotals((journal.data ?? []).map((row) => row.outcome ?? null)),
    };
  });

/**
 * Symbol-binding surface (owner only).
 *
 * These three functions exist for exactly one deadlock: discovery correctly
 * refuses to pick between several broker tickers, or finds none, so the
 * instrument can never earn evidence. A named operator records the one true
 * ticker; nothing else about the lifecycle is bypassed by that act.
 */
export interface SymbolBindingView {
  canonical: string;
  stage: string | null;
  binding: {
    providerSymbol: string;
    boundBy: string;
    reason: string | null;
    updatedAt: string | null;
  } | null;
  /** Latest discovery evidence: what the broker inventory actually offered. */
  discovery: {
    outcome: string | null;
    candidates: string[];
    checkedAt: string | null;
  } | null;
  /** The broker ticker the stored specification was fetched under, if any. */
  specProviderSymbol: string | null;
  specFetchedAt: string | null;
}

export const getAdminSymbolBindings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SymbolBindingView[]> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listBindings } = await import("@/lib/instruments/bindings.server");
    const { INSTRUMENTS } = await import("@/lib/scanner/types");

    const [bindings, lifecycle, discovery, specs] = await Promise.all([
      listBindings(supabaseAdmin as never),
      supabaseAdmin.from("instrument_lifecycle").select("symbol, stage"),
      supabaseAdmin
        .from("instrument_alias_discovery")
        .select("canonical, outcome, candidates, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("broker_symbol_specs").select("symbol, provider_symbol, fetched_at"),
    ]);

    const stageOf = new Map(
      (lifecycle.data ?? []).map((r) => [String(r.symbol), r.stage as string | null]),
    );
    const specOf = new Map((specs.data ?? []).map((r) => [String(r.symbol), r]));
    const bindingOf = new Map(bindings.map((b) => [b.canonical, b]));
    const latestDiscovery = new Map<string, NonNullable<typeof discovery.data>[number]>();
    for (const row of discovery.data ?? []) {
      if (!latestDiscovery.has(String(row.canonical)))
        latestDiscovery.set(String(row.canonical), row);
    }

    return INSTRUMENTS.map((symbol) => {
      const binding = bindingOf.get(symbol) ?? null;
      const disc = latestDiscovery.get(symbol) ?? null;
      const spec = specOf.get(symbol) ?? null;
      return {
        canonical: symbol,
        stage: stageOf.get(symbol) ?? null,
        binding: binding
          ? {
              providerSymbol: binding.providerSymbol,
              boundBy: binding.boundBy,
              reason: binding.reason,
              updatedAt: binding.updatedAt,
            }
          : null,
        discovery: disc
          ? {
              outcome: (disc.outcome as string | null) ?? null,
              candidates: Array.isArray(disc.candidates) ? (disc.candidates as string[]) : [],
              checkedAt: (disc.created_at as string | null) ?? null,
            }
          : null,
        specProviderSymbol: (spec?.provider_symbol as string | null) ?? null,
        specFetchedAt: (spec?.fetched_at as string | null) ?? null,
      };
    });
  });

export const bindInstrumentSymbol = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { canonical: string; providerSymbol: string; reason?: string }) => data)
  .handler(async ({ context, data }): Promise<{ ok: boolean; error: string | null }> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const canonical = String(data.canonical ?? "")
      .trim()
      .toUpperCase();
    const providerSymbol = String(data.providerSymbol ?? "").trim();
    if (!canonical || !providerSymbol) {
      return {
        ok: false,
        error: "Both a canonical instrument and one exact broker symbol are required.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { INSTRUMENTS } = await import("@/lib/scanner/types");
    if (!(INSTRUMENTS as readonly string[]).includes(canonical)) {
      return { ok: false, error: `${canonical} is not a registered instrument.` };
    }

    // The chosen ticker must exist in the broker's own inventory. A binding to a
    // name the broker never listed would fail at fetch time with no explanation.
    const { fetchInventory } = await import("@/lib/instruments/discovery.server");
    const inventory = await fetchInventory();
    if (inventory.length === 0) {
      return {
        ok: false,
        error: "The broker symbol inventory could not be read, so the binding was not recorded.",
      };
    }
    if (!inventory.includes(providerSymbol)) {
      return { ok: false, error: `The broker inventory does not list "${providerSymbol}".` };
    }

    const { readBinding, writeBinding } = await import("@/lib/instruments/bindings.server");
    const previous = await readBinding(supabaseAdmin as never, canonical);
    const { data: disc } = await supabaseAdmin
      .from("instrument_alias_discovery")
      .select("candidates, outcome, created_at")
      .eq("canonical", canonical)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const result = await writeBinding(supabaseAdmin as never, {
      canonical,
      providerSymbol,
      boundBy: email,
      reason: data.reason ?? null,
      candidates: Array.isArray(disc?.candidates) ? (disc?.candidates as string[]) : [],
      evidence: {
        discovery_outcome: disc?.outcome ?? null,
        discovery_checked_at: disc?.created_at ?? null,
        previous_provider_symbol: previous?.providerSymbol ?? null,
        inventory_size: inventory.length,
      },
    });
    return result;
  });

export const unbindInstrumentSymbol = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { canonical: string }) => data)
  .handler(async ({ context, data }): Promise<{ ok: boolean; error: string | null }> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { deleteBinding } = await import("@/lib/instruments/bindings.server");
    return deleteBinding(supabaseAdmin as never, String(data.canonical ?? ""));
  });

/**
 * Owner-triggered commissioning recheck for ONE instrument.
 *
 * Everything the automatic passes do — alias discovery, specification refresh,
 * readiness snapshot — but for a single named symbol, on demand, so an operator
 * can see immediately whether a fresh binding actually works instead of waiting a
 * day for the next cron. It writes evidence only: no lifecycle stage changes, no
 * publication, no order.
 *
 * The 24h specification budget is cleared for this one symbol first, because the
 * whole point of the recheck is to re-ask the provider under a name that changed.
 */
export const recommissionInstrument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { canonical: string }) => data)
  .handler(async ({ context, data }) => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const canonical = String(data.canonical ?? "")
      .trim()
      .toUpperCase();
    const { INSTRUMENTS } = await import("@/lib/scanner/types");
    if (!(INSTRUMENTS as readonly string[]).includes(canonical)) {
      throw new Error(`${canonical} is not a registered instrument.`);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("spec_refresh_attempts").delete().eq("symbol", canonical);

    const { runCommissioningPass } = await import("@/lib/instruments/commissioning.server");
    const { fetchInventory } = await import("@/lib/instruments/discovery.server");
    const inventory = await fetchInventory();
    const result = await runCommissioningPass(
      supabaseAdmin as never,
      canonical,
      inventory.length ? inventory : null,
    );

    return {
      canonical,
      discoveryOutcome: result.discoveryOutcome,
      specAction: result.specAction,
      snapshotWritten: result.snapshotWritten,
      mayEnterDataValidation: result.decision.mayEnterDataValidation,
      blockers: result.decision.blockers as string[],
      detail: result.decision.detail,
      providerSymbol: result.decision.symbol,
      error: result.error,
    };
  });

export interface AdminExecutionQualityRow {
  accountId: string;
  instrument: string;
  session: string;
  computedAt: string;
  closedSample: number;
  medianSlippage: number | null;
  p90Slippage: number | null;
  avgR: number | null;
  deliverySample: number;
  rejectRate: number | null;
  marginRefusals: number;
  normMedianSlippage: number | null;
  normRejectRate: number | null;
  measured: boolean;
  unmeasuredReason: string | null;
}

export interface AdminExecutionCooldownRow {
  accountId: string;
  instrument: string;
  session: string;
  reason: string;
  detail: string | null;
  startedAt: string;
  resumeAfter: string;
}

export interface AdminExecutionQuality {
  scores: AdminExecutionQualityRow[];
  cooldowns: AdminExecutionCooldownRow[];
}

/**
 * Execution quality per account/instrument/session, plus any automatic pause
 * currently in force (owner only).
 *
 * Pure read of already-computed rows: the scheduled rollup writes them, this
 * only reports them. A dimension with too little recorded broker evidence comes
 * back as "not measured" and is shown as such — never as a zero.
 */
export const getAdminExecutionQuality = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminExecutionQuality> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();
    const [scores, cooldowns] = await Promise.all([
      supabaseAdmin
        .from("execution_quality_scores")
        .select(
          "account_id, instrument, session, computed_at, closed_sample, median_slippage, p90_slippage, avg_r, delivery_sample, reject_rate, margin_refusals, norm_median_slippage, norm_reject_rate, measured, unmeasured_reason",
        )
        .order("computed_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("execution_cooldowns")
        .select("account_id, instrument, session, reason, detail, started_at, resume_after")
        .is("lifted_at", null)
        .gt("resume_after", nowIso)
        .order("resume_after", { ascending: false })
        .limit(100),
    ]);
    if (scores.error) throw new Error(scores.error.message);
    if (cooldowns.error) throw new Error(cooldowns.error.message);

    return {
      scores: ((scores.data ?? []) as Record<string, unknown>[]).map((r) => ({
        accountId: String(r["account_id"]),
        instrument: String(r["instrument"]),
        session: String(r["session"]),
        computedAt: String(r["computed_at"]),
        closedSample: Number(r["closed_sample"] ?? 0),
        medianSlippage: r["median_slippage"] === null ? null : Number(r["median_slippage"]),
        p90Slippage: r["p90_slippage"] === null ? null : Number(r["p90_slippage"]),
        avgR: r["avg_r"] === null ? null : Number(r["avg_r"]),
        deliverySample: Number(r["delivery_sample"] ?? 0),
        rejectRate: r["reject_rate"] === null ? null : Number(r["reject_rate"]),
        marginRefusals: Number(r["margin_refusals"] ?? 0),
        normMedianSlippage:
          r["norm_median_slippage"] === null ? null : Number(r["norm_median_slippage"]),
        normRejectRate: r["norm_reject_rate"] === null ? null : Number(r["norm_reject_rate"]),
        measured: r["measured"] === true,
        unmeasuredReason: r["unmeasured_reason"] === null ? null : String(r["unmeasured_reason"]),
      })),
      cooldowns: ((cooldowns.data ?? []) as Record<string, unknown>[]).map((r) => ({
        accountId: String(r["account_id"]),
        instrument: String(r["instrument"]),
        session: String(r["session"]),
        reason: String(r["reason"]),
        detail: r["detail"] === null ? null : String(r["detail"]),
        startedAt: String(r["started_at"]),
        resumeAfter: String(r["resume_after"]),
      })),
    };
  });

export interface AdminWalkForwardRow {
  gate: string;
  confirmed: boolean;
  splitDay: string | null;
  trainDays: number;
  holdoutDays: number;
  trainPassN: number;
  trainFailN: number;
  holdoutPassN: number;
  holdoutFailN: number;
  trainDeltaR: number | null;
  holdoutDeltaR: number | null;
  holdoutLow: number | null;
  holdoutHigh: number | null;
  blockers: string[];
  detail: string;
  computedAt: string;
}

/**
 * Out-of-sample (walk-forward) confirmation per gate, owner only.
 *
 * Pure read of rows the hourly pass wrote. No row for a gate means no
 * confirmation exists — which withholds any automatic threshold change for that
 * gate rather than permitting one.
 */
export const getAdminWalkForward = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminWalkForwardRow[]> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("walk_forward_confirmations")
      .select("*")
      .order("gate", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);

    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      gate: String(r["gate"]),
      confirmed: r["confirmed"] === true,
      splitDay: r["split_day"] === null ? null : String(r["split_day"]),
      trainDays: Number(r["train_days"] ?? 0),
      holdoutDays: Number(r["holdout_days"] ?? 0),
      trainPassN: Number(r["train_pass_n"] ?? 0),
      trainFailN: Number(r["train_fail_n"] ?? 0),
      holdoutPassN: Number(r["holdout_pass_n"] ?? 0),
      holdoutFailN: Number(r["holdout_fail_n"] ?? 0),
      trainDeltaR: r["train_delta_r"] === null ? null : Number(r["train_delta_r"]),
      holdoutDeltaR: r["holdout_delta_r"] === null ? null : Number(r["holdout_delta_r"]),
      holdoutLow: r["holdout_low"] === null ? null : Number(r["holdout_low"]),
      holdoutHigh: r["holdout_high"] === null ? null : Number(r["holdout_high"]),
      blockers: Array.isArray(r["blockers"]) ? (r["blockers"] as string[]).map(String) : [],
      detail: String(r["detail"] ?? ""),
      computedAt: String(r["computed_at"] ?? ""),
    }));
  });

export interface AdminExitVariantRow {
  variant: string;
  samples: number;
  undecidable: number;
  clusters: number;
  meanR: number | null;
  baselineMeanR: number | null;
  deltaR: number | null;
  holdoutConfirmed: boolean;
  holdoutDeltaR: number | null;
  holdoutLow: number | null;
  holdoutHigh: number | null;
  splitDay: string | null;
  blockers: string[];
  detail: string;
  computedAt: string;
}

/**
 * Replay-only exit-variant research, owner only.
 *
 * These are simulated outcomes over recorded market paths, not executed trades.
 * The live policy is unaffected by anything shown here.
 */
export const getAdminExitVariants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminExitVariantRow[]> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("exit_variant_results")
      .select("*")
      .order("variant", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);

    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      variant: String(r["variant"]),
      samples: Number(r["samples"] ?? 0),
      undecidable: Number(r["undecidable"] ?? 0),
      clusters: Number(r["clusters"] ?? 0),
      meanR: r["mean_r"] === null ? null : Number(r["mean_r"]),
      baselineMeanR: r["baseline_mean_r"] === null ? null : Number(r["baseline_mean_r"]),
      deltaR: r["delta_r"] === null ? null : Number(r["delta_r"]),
      holdoutConfirmed: r["holdout_confirmed"] === true,
      holdoutDeltaR: r["holdout_delta_r"] === null ? null : Number(r["holdout_delta_r"]),
      holdoutLow: r["holdout_low"] === null ? null : Number(r["holdout_low"]),
      holdoutHigh: r["holdout_high"] === null ? null : Number(r["holdout_high"]),
      splitDay: r["split_day"] === null ? null : String(r["split_day"]),
      blockers: Array.isArray(r["blockers"]) ? (r["blockers"] as string[]).map(String) : [],
      detail: String(r["detail"] ?? ""),
      computedAt: String(r["computed_at"] ?? ""),
    }));
  });
