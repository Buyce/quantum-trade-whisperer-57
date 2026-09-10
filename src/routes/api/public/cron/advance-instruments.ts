/**
 * Daily automatic stage advancement (cron-authorised).
 *
 * Evaluates every registry instrument against recorded evidence and applies at
 * most ONE audited stage change each. Promotion is a lifecycle permission only:
 * this endpoint never touches the global execution switch, an account's own
 * settings, the risk brakes or the intelligence gate.
 *
 * Fails closed twice over — an unauthorised caller is rejected, and an unreadable
 * `auto_stage_advance_enabled` switch moves nothing.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/cron/advance-instruments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAdvancement } = await import("@/lib/instruments/advancement.server");

        const run = await runAdvancement(supabaseAdmin);
        const changed = run.applied.filter((a) => a.ok);

        // Notify only on an actual change, and never let a mail failure lose the
        // transition that has already been recorded in the audit log.
        if (changed.length > 0) {
          try {
            const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
            await sendTemplateEmail("instrument-stage-changed", "", {
              idempotencyKey: `stage-advance-${run.ranAt.slice(0, 10)}-${changed
                .map((c) => `${c.instrument}:${c.to}`)
                .join(",")}`,
              templateData: {
                ranAt: run.ranAt,
                changes: changed.map((c) => {
                  const verdict = run.verdicts.find((v) => v.instrument === c.instrument);
                  return {
                    instrument: c.instrument,
                    from: c.from,
                    to: c.to,
                    action: c.action,
                    reasons: verdict?.reasons ?? [],
                  };
                }),
              },
            });
          } catch (err) {
            console.error("[cron/advance-instruments] notification failed", err);
          }
        }

        return Response.json({
          ok: true,
          ranAt: run.ranAt,
          enabled: run.enabled,
          applied: run.applied,
          holds: run.verdicts
            .filter((v) => v.action === "hold")
            .map((v) => ({ instrument: v.instrument, stage: v.stage, reasons: v.reasons })),
          warnings: run.warnings,
        });
      },
    },
  },
});
