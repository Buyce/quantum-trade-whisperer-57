/**
 * Manual scan trigger for signed-in operators.
 *
 * Enqueues one job per monitored instrument and drains the queue in the same
 * request, returning the real per-instrument outcome. No secrets reach the
 * browser and nothing is ever synthesized — an empty result set is truth.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ManualScanResult {
  runId: string;
  enqueued: number;
  processed: Array<{ instrument: string; status: string; detail?: string }>;
}

export const runScanNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ManualScanResult> => {
    const { adminClient, enqueueScanCycle, processNextJob, describeError } =
      await import("@/lib/scanner/pipeline.server");
    const db = adminClient();
    const { runId, enqueued } = await enqueueScanCycle(db);

    const processed: ManualScanResult["processed"] = [];
    for (let i = 0; i < enqueued + 2; i++) {
      try {
        const result = await processNextJob(db);
        if (!result) break;
        processed.push({
          instrument: result.instrument,
          status: result.status,
          ...(result.detail ? { detail: result.detail } : {}),
        });
      } catch (err) {
        processed.push({ instrument: "queue", status: "failed", detail: describeError(err) });
        break;
      }
    }

    return { runId, enqueued, processed };
  });
