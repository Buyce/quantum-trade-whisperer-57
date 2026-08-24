import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PerformanceEvidenceRow } from "@/lib/performance-evidence";

const inputSchema = z.object({ source: z.enum(["customer", "benchmark"]) });

export const getBrokerPerformanceEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<PerformanceEvidenceRow[]> => {
    const { loadPerformanceEvidence } = await import("@/lib/performance-evidence.server");
    return await loadPerformanceEvidence(context.supabase, context.userId, data.source);
  });
