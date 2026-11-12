/**
 * Public uptime probe: 200 only when the scanner finished real analysis in the
 * last 30 minutes and every instrument in the scan universe has a finished
 * outcome (or the FX week is closed). Idle worker passes and stale-discarded
 * jobs never count. Returns instrument names and timestamps only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { judgeFreshness, SCAN_STALE_MS, type ScanOutcome } from "@/lib/ops/freshness";
import { describeError } from "@/lib/errors/describe";

export const Route = createFileRoute("/api/public/health/pipeline")({
  server: {
    handlers: {
      GET: async () => {
        const now = new Date();
        let readError: string | null = null;
        let universe: string[] = [];
        let outcomes: ScanOutcome[] = [];
        try {
          const { adminClient, scanUniverse } = await import("@/lib/scanner/pipeline.server");
          const db = adminClient();
          universe = [...(await scanUniverse(db))];
          const { data, error } = await db
            .from("scan_queue")
            .select("instrument, result, finished_at")
            .eq("status", "done")
            .gt("finished_at", new Date(now.getTime() - SCAN_STALE_MS).toISOString())
            .limit(1000);
          if (error) readError = error.message;
          else
            outcomes = (data ?? []).map((r) => ({
              instrument: String(r.instrument),
              result: (r.result as string | null) ?? null,
              finishedAt: String(r.finished_at),
            }));
        } catch (err) {
          readError = describeError(err);
        }
        const v = judgeFreshness({ now, readError, universe, outcomes });
        return Response.json(
          { ...v, checkedAt: now.toISOString() },
          { status: v.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
