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
  updatedAt: string | null;
}

const SWITCH_COLUMNS =
  "demo_auto_enabled, force_dry_run, live_execution_enabled, live_auto_enabled, execution_policy, allowed_live_hosts, updated_at";

interface SwitchRow {
  demo_auto_enabled?: boolean;
  force_dry_run?: boolean;
  live_execution_enabled?: boolean;
  live_auto_enabled?: boolean;
  execution_policy?: string;
  allowed_live_hosts?: string[] | null;
  updated_at?: string;
}

/**
 * Defaults are the SAFE reading of a missing value: nothing armed, dry-run on,
 * no host allowed. An unreadable control is never read as permission.
 */
function mapSwitches(row: SwitchRow | null): AdminExecutionSwitches {
  return {
    demoAutoEnabled: row?.demo_auto_enabled === true,
    forceDryRun: row?.force_dry_run !== false,
    liveExecutionEnabled: row?.live_execution_enabled === true,
    liveAutoEnabled: row?.live_auto_enabled === true,
    executionPolicy: row?.execution_policy ?? "single_exit_first_target",
    allowedLiveHosts: row?.allowed_live_hosts ?? [],
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
 *  - Live execution cannot be enabled while `force_dry_run` is on, and cannot be
 *    enabled with an empty host allow-list — an armed switch with no destination
 *    is a trap, not a feature.
 *  - Hosts are normalised to bare lowercase hostnames and must be plain
 *    hostnames; a URL, a path, a port or a wildcard is rejected here so the
 *    allow-list can never be widened by a sloppy entry. Per-request SSRF
 *    validation at dispatch is unchanged and still authoritative.
 *  - Turning anything OFF is always accepted, with no preconditions.
 */
export const setAdminExecutionSwitches = createServerFn({ method: "POST" })
  .validator(
    (input: {
      demoAutoEnabled?: boolean;
      forceDryRun?: boolean;
      liveExecutionEnabled?: boolean;
      liveAutoEnabled?: boolean;
      allowedLiveHosts?: string[];
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

    if (typeof data.liveExecutionEnabled === "boolean") {
      if (data.liveExecutionEnabled) {
        if (dryRunAfter)
          throw new Error("Turn the system-wide dry-run lock off before enabling live execution.");
        if (hosts.length === 0)
          throw new Error("Add at least one allowed live host before enabling live execution.");
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

