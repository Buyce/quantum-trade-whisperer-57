import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AutomaticOrderSummary } from "@/lib/automatic-order-summary";
import type { PerformanceEvidenceRow } from "@/lib/performance-evidence";

export const getBrokerPerformanceEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ source: z.enum(["customer", "benchmark"]) }).parse(input))
  .handler(async ({ data, context }): Promise<PerformanceEvidenceRow[]> => {
    const { loadPerformanceEvidence } = await import("@/lib/performance-evidence.server");
    return await loadPerformanceEvidence(context.supabase, context.userId, data.source);
  });

export const getAutomaticOrderSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomaticOrderSummary> => {
    const { loadAutomaticOrderSummary } = await import("@/lib/automatic-order-summary.server");
    return await loadAutomaticOrderSummary(context.supabase, context.userId);
  });
