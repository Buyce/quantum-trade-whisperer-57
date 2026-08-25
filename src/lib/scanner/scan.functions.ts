/**
 * Manual scan trigger for signed-in operators.
 *
 * Enqueues one job per monitored instrument and drains the queue in the same
 * request, then reconciles the report against the run's own queue rows. This
 * matters because the background worker shares the same queue: it can claim one
 * of this run's jobs first, in which case the manual drain never sees it. The
 * report therefore states the run's real outcome and says how many jobs another
 * worker completed, instead of listing fewer instruments than it enqueued.
 *
 * No secrets reach the browser and nothing is ever synthesized — an unfinished
 * job is reported as unfinished, never as a result.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ManualScanResult {
  runId: string;
  enqueued: number;
  processed: Array<{
    instrument: string;
    status: string;
    detail?: string;
    /** True when the background worker, not this request, completed the job. */
    byBackgroundWorker?: boolean;
  }>;
  /** Jobs of this run completed by the background worker rather than this call. */
  claimedByWorker: number;
  /** Jobs of this run still unfinished when the report was written. */
  stillPending: number;
  /** Set when the run's own queue rows could not be re-read. */
  reconcileError?: string;
}

interface QueueRow {
  instrument: string;
  status: string | null;
  result: string | null;
  error: string | null;
}

export const runScanNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ManualScanResult> => {
    const { adminClient, enqueueScanCycle, processNextJob, describeError } =
      await import("@/lib/scanner/pipeline.server");
    const db = adminClient();
    const { runId, enqueued } = await enqueueScanCycle(db);

    // Locally observed outcomes. The drain is queue-wide, so an entry here is not
    // necessarily one of this run's jobs; the reconciliation below is authority.
    const drained: ManualScanResult["processed"] = [];
    for (let i = 0; i < enqueued + 2; i++) {
      try {
        const result = await processNextJob(db);
        if (!result) break;
        drained.push({
          instrument: result.instrument,
          status: result.status,
          ...(result.detail ? { detail: result.detail } : {}),
        });
      } catch (err) {
        drained.push({ instrument: "queue", status: "failed", detail: describeError(err) });
        break;
      }
    }

    const { data, error } = await db
      .from("scan_queue")
      .select("instrument, status, result, error")
      .eq("run_id", runId);

    if (error) {
      // Report what was actually observed and say the reconciliation failed,
      // rather than implying the listed instruments are the whole run.
      return {
        runId,
        enqueued,
        processed: drained,
        claimedByWorker: 0,
        stillPending: 0,
        reconcileError: error.message,
      };
    }

    const rows = (data ?? []) as unknown as QueueRow[];
    const drainedByInstrument = new Map(drained.map((d) => [d.instrument, d]));
    const processed: ManualScanResult["processed"] = [];
    let claimedByWorker = 0;
    let stillPending = 0;

    for (const row of rows) {
      const local = drainedByInstrument.get(row.instrument);
      if (local) {
        processed.push(local);
        continue;
      }
      const terminal = row.status === "done" || row.status === "failed";
      if (terminal) {
        claimedByWorker += 1;
        processed.push({
          instrument: row.instrument,
          status: row.result ?? row.status ?? "done",
          ...(row.error ? { detail: row.error } : {}),
          byBackgroundWorker: true,
        });
      } else {
        stillPending += 1;
        processed.push({
          instrument: row.instrument,
          status: "pending",
          detail: "still queued — the background worker will complete it",
        });
      }
    }

    // Failures the drain hit that belong to no instrument row (e.g. "queue").
    for (const entry of drained) {
      if (!rows.some((row) => row.instrument === entry.instrument)) processed.push(entry);
    }

    return { runId, enqueued, processed, claimedByWorker, stillPending };
  });
