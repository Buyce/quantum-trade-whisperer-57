/**
 * Public uptime probe: 200 only when a scanner pass actually succeeded in the
 * last 30 minutes (or FX is closed). Returns timestamps only, no private data.
 * An unreadable backend returns 503, so an outside monitor sees silent outages.
 */
import { createFileRoute } from "@tanstack/react-router";
import { judgeFreshness } from "@/lib/ops/freshness";
import { describeError } from "@/lib/errors/describe";

export const Route = createFileRoute("/api/public/health/pipeline")({
  server: {
    handlers: {
      GET: async () => {
        let readError: string | null = null;
        let lastSampleAt: string | null = null;
        try {
          const { adminClient } = await import("@/lib/scanner/pipeline.server");
          const { data, error } = await adminClient()
            .from("worker_call_health")
            .select("sampled_at")
            .gt("scanner_ok", 0)
            .order("sampled_at", { ascending: false })
            .limit(1);
          if (error) readError = error.message;
          else lastSampleAt = (data?.[0]?.sampled_at as string | undefined) ?? null;
        } catch (err) {
          readError = describeError(err);
        }
        const v = judgeFreshness({
          now: new Date(),
          readError,
          lastSampleAt,
          lastSampleOk: lastSampleAt ? true : null,
        });
        return Response.json(
          { ...v, checkedAt: new Date().toISOString() },
          { status: v.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
