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
  p_fill_shrunk: number;
  p_win_shrunk: number;
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
}

export const getAdminIntelligence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminIntelligence> => {
    const email = String(context.claims['email'] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) {
      throw new Error("Forbidden");
    }

    const { data, error } = await context.supabase.rpc("get_admin_intelligence");
    if (error) throw new Error(error.message);
    return data as unknown as AdminIntelligence;
  });
