/**
 * Owner-only read of the current weekly shadow report so the admin terminal can
 * show this week's A/A+ vs B/C comparison without waiting for Monday's email.
 *
 * Same email gate as admin.functions.ts. The shadow tables are service-role
 * only, so the aggregation runs with the admin client inside the handler and
 * returns aggregates exclusively — no per-user rows.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WeeklyReport } from "./weekly";

const OWNER_EMAIL = "boatengampomah@gmail.com";

export const getWeeklyShadowReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WeeklyReport> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadWeeklyReport } = await import("./weekly.server");
    return loadWeeklyReport(supabaseAdmin);
  });
