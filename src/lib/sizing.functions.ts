/**
 * Authenticated sizing RPC. The terminal's risk panel calls this instead of
 * computing sizing in the browser, so the UI and MCP share one implementation,
 * one provenance vocabulary and one authoritative model.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const input = z.object({
  instrument: z.string().min(3),
  entryPrice: z.number().finite(),
  stopLoss: z.number().finite(),
  finalTargetR: z.number().finite().nullable().optional(),
  signalId: z.string().uuid().nullable().optional(),
});

export const resolveSizingForSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { resolveSizingForUser } = await import("./sizing/service.server");
    return resolveSizingForUser(context.supabase, context.userId, {
      instrument: data.instrument,
      entryPrice: data.entryPrice,
      stopLoss: data.stopLoss,
      finalTargetR: data.finalTargetR ?? null,
      signalId: data.signalId ?? null,
    });
  });
