/**
 * Weekly fill-price verification reminder cron. Emails and pushes each user who
 * has closed trades logged without the actual entry/exit prices. Latched per
 * user per ISO week in the database, so a retry cannot send twice.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/verify-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { adminClient } = await import("@/lib/scanner/pipeline.server");
        const { sendVerifyReminders } = await import("@/lib/journal/verify-reminders.server");

        try {
          const result = await sendVerifyReminders(adminClient());
          return Response.json({
            ok: true,
            week: result.week,
            candidates: result.candidates,
            emailsSent: result.results.filter((r) => r.emailSent).length,
            pushSent: result.results.reduce((sum, r) => sum + r.pushSent, 0),
            skipped: result.results.filter((r) => !r.claimed).length,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[cron/verify-reminders] failed:", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
