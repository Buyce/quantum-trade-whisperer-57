/**
 * Baseline snapshot surface.
 *
 * `captureBaseline` is owner-only and writes one immutable document.
 * `getBaselineStatus` is a read for the admin terminal: active model version
 * plus the most recent capture. Both gates check the verified bearer claims.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ACTIVE_MODEL_LABEL, ACTIVE_MODEL_VERSION } from "@/lib/versioning";

const OWNER_EMAIL = "boatengampomah@gmail.com";

export interface BaselineStatus {
  modelVersion: number;
  modelLabel: string;
  latest: {
    id: string;
    kind: string;
    captured_at: string;
    pinned_run_id: string | null;
    // `any` here is deliberate: the document is arbitrary JSON and the RPC
    // serializer rejects `unknown` index signatures.
    metrics: Record<string, any>;
  } | null;
  total: number;
}

export const getBaselineStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BaselineStatus> => {
    const { data, error } = await context.supabase
      .from("baseline_snapshots")
      .select("id, kind, captured_at, pinned_run_id, metrics")
      .eq("model_version", ACTIVE_MODEL_VERSION)
      .order("captured_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);

    const { count, error: countError } = await context.supabase
      .from("baseline_snapshots")
      .select("id", { count: "exact", head: true });
    if (countError) throw new Error(countError.message);

    return {
      modelVersion: ACTIVE_MODEL_VERSION,
      modelLabel: ACTIVE_MODEL_LABEL,
      latest: (data?.[0] as BaselineStatus["latest"]) ?? null,
      total: count ?? 0,
    };
  });

export const runBaselineCapture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = String(context.claims['email'] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { adminClient } = await import("@/lib/scanner/pipeline.server");
    const { captureBaseline } = await import("@/lib/baseline/capture.server");
    const result = await captureBaseline(adminClient());
    return {
      captured: result.captured,
      reason: result.reason ?? null,
      pinnedRunId: result.pinnedRunId,
      metrics: result.metrics,
    };
  });
