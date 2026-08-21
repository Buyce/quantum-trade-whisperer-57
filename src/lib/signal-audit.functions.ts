/**
 * Signal audit aggregates: per-signal grade, how many times users skipped it,
 * and how many times it was enrolled in / replayed by the shadow engine.
 *
 * ZERO-HALLUCINATION: every number here is a COUNT over live rows written by
 * the scanner pipeline, the user decision log and the shadow engine. Zero is a
 * real answer and is returned as zero — never padded with example rows.
 *
 * The shadow tables are service-role only, so the aggregation runs server-side
 * and returns counts exclusively (no user ids, no per-user rows).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({ limit: z.number().int().min(1).max(500).default(200) });

export interface SignalAuditRow {
  id: string;
  instrument: string;
  grade: string;
  direction: string;
  detectedAt: string;
  status: string;
  confidenceScore: number | null;
  /** Decisions logged against this setup, across all users. */
  takenCount: number;
  skippedCount: number;
  /** Rows in the shadow queue for this signal (enrolments). */
  shadowEnrolments: number;
  /** Forward-test executions the shadow engine created for it. */
  shadowExecutions: number;
  shadowResolved: number;
  shadowStatus: string | null;
}

export const getSignalAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data ?? {}))
  .handler(async ({ data }): Promise<SignalAuditRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: signals, error } = await supabaseAdmin
      .from("scanned_signals")
      .select("id, instrument, grade, direction, detected_at, status, confidence_score")
      .order("detected_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    const rows = signals ?? [];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);

    const [decisions, queue, executions] = await Promise.all([
      supabaseAdmin.from("executed_trades").select("signal_id, user_decision").in("signal_id", ids),
      supabaseAdmin.from("shadow_queue").select("signal_id, status").in("signal_id", ids),
      supabaseAdmin
        .from("shadow_executions_production")
        .select("signal_id, status")
        // Production replay rows only — research siblings share the signal id.
        .eq("replay_version", 1)
        .in("signal_id", ids),
    ]);

    const taken = new Map<string, number>();
    const skipped = new Map<string, number>();
    for (const d of decisions.data ?? []) {
      const target = d.user_decision === "taken" ? taken : skipped;
      target.set(d.signal_id, (target.get(d.signal_id) ?? 0) + 1);
    }

    const enrolled = new Map<string, number>();
    for (const q of queue.data ?? []) {
      if (!q.signal_id) continue;
      enrolled.set(q.signal_id, (enrolled.get(q.signal_id) ?? 0) + 1);
    }

    const execCount = new Map<string, number>();
    const resolvedCount = new Map<string, number>();
    const lastStatus = new Map<string, string>();
    for (const e of executions.data ?? []) {
      if (!e.signal_id) continue;
      execCount.set(e.signal_id, (execCount.get(e.signal_id) ?? 0) + 1);
      if (e.status === "resolved") resolvedCount.set(e.signal_id, (resolvedCount.get(e.signal_id) ?? 0) + 1);
      lastStatus.set(e.signal_id, e.status);
    }

    return rows.map((r) => ({
      id: r.id,
      instrument: r.instrument,
      grade: r.grade as string,
      direction: r.direction as string,
      detectedAt: r.detected_at,
      status: r.status,
      confidenceScore: r.confidence_score == null ? null : Number(r.confidence_score),
      takenCount: taken.get(r.id) ?? 0,
      skippedCount: skipped.get(r.id) ?? 0,
      shadowEnrolments: enrolled.get(r.id) ?? 0,
      shadowExecutions: execCount.get(r.id) ?? 0,
      shadowResolved: resolvedCount.get(r.id) ?? 0,
      shadowStatus: lastStatus.get(r.id) ?? null,
    }));
  });
