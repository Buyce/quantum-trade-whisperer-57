/**
 * Server-only account lifecycle helpers.
 *
 * Cancellation is a soft, reversible state on the profile row. Permanent
 * deletion only happens after the 30-day grace period, executed by the daily
 * purge cron. Nothing here touches the scanner pipeline or signal data.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const GRACE_PERIOD_DAYS = 30;

export function accountAdminClient(): SupabaseClient {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface PurgeReport {
  scanned: number;
  deleted: string[];
  failed: Array<{ userId: string; error: string }>;
}

/** Permanently remove accounts whose grace period has elapsed. */
export async function purgeExpiredAccounts(db: SupabaseClient): Promise<PurgeReport> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("profiles")
    .select("id")
    .not("deletion_scheduled_for", "is", null)
    .lte("deletion_scheduled_for", nowIso)
    .limit(200);
  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: string }>;
  const report: PurgeReport = { scanned: rows.length, deleted: [], failed: [] };

  for (const row of rows) {
    try {
      await db.from("executed_trades").delete().eq("user_id", row.id);
      await db.from("feedback").delete().eq("user_id", row.id);
      await db.from("scanner_settings").delete().eq("user_id", row.id);
      await db.from("profiles").delete().eq("id", row.id);
      const { error: authError } = await db.auth.admin.deleteUser(row.id);
      if (authError) throw authError;
      report.deleted.push(row.id);
    } catch (err) {
      report.failed.push({
        userId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}
