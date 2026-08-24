/**
 * Short-lived interaction telemetry. Records that a user took, skipped or
 * viewed a setup for product/research diagnostics. It is not a market-outcome
 * label and is not automatically promoted into a predictive model. The row
 * follows the feed signal's retention lifecycle. Fire-and-forget: callers must
 * never await it on the interaction path.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  signalId: z.string().uuid(),
  event: z.enum(["skipped", "taken", "viewed"]),
});

export const recordSignalEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("signal_user_telemetry").insert({
      user_id: context.userId,
      signal_id: data.signalId,
      event: data.event,
    });
    // Unique violation just means the same event was already logged.
    if (error && error.code !== "23505") return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
