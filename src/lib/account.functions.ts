/**
 * Account cancellation server functions.
 *
 * Soft-cancel with a 30-day grace period: the profile is flagged, the trader is
 * signed out client-side, and signing back in reverses it. Scanner, signal and
 * alert pipelines are untouched.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface DeletionStatus {
  requestedAt: string | null;
  scheduledFor: string | null;
}

export const getDeletionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeletionStatus> => {
    const { data, error } = await context.supabase
      .from("profiles" as never)
      .select("deletion_requested_at, deletion_scheduled_for")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as {
      deletion_requested_at: string | null;
      deletion_scheduled_for: string | null;
    } | null;
    return {
      requestedAt: row?.deletion_requested_at ?? null,
      scheduledFor: row?.deletion_scheduled_for ?? null,
    };
  });

export const requestAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ scheduledFor: string }> => {
    const { GRACE_PERIOD_DAYS, formatDeadline } = await import("@/lib/account.server");
    const requestedAt = new Date();
    const scheduledFor = new Date(requestedAt.getTime() + GRACE_PERIOD_DAYS * 86_400_000);

    const { error } = await context.supabase
      .from("profiles" as never)
      .update({
        deletion_requested_at: requestedAt.toISOString(),
        deletion_scheduled_for: scheduledFor.toISOString(),
      } as never)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    const email =
      typeof context.claims["email"] === "string" ? (context.claims["email"] as string) : null;
    const deadline = formatDeadline(scheduledFor.toISOString());

    try {
      const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
      if (email) {
        await sendTemplateEmail("account-cancellation", email, {
          templateData: { restoreDeadline: deadline },
          idempotencyKey: `account-cancellation-${context.userId}-${requestedAt.toISOString().slice(0, 10)}`,
        });
      }
      await sendTemplateEmail("account-cancellation-admin", "", {
        templateData: {
          userEmail: email ?? "unknown",
          userId: context.userId,
          requestedAt: formatDeadline(requestedAt.toISOString()),
          scheduledFor: deadline,
        },
        idempotencyKey: `account-cancellation-admin-${context.userId}-${requestedAt.toISOString().slice(0, 10)}`,
      });
    } catch (err) {
      // Email failure must never block the cancellation itself.
      console.error("[requestAccountDeletion] email failed", err);
    }

    return { scheduledFor: scheduledFor.toISOString() };
  });

export const cancelAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ restored: boolean }> => {
    const { data, error: readError } = await context.supabase
      .from("profiles" as never)
      .select("deletion_scheduled_for")
      .eq("id", context.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const pending =
      (data as { deletion_scheduled_for: string | null } | null)?.deletion_scheduled_for ?? null;
    if (!pending) return { restored: false };

    const { error } = await context.supabase
      .from("profiles" as never)
      .update({ deletion_requested_at: null, deletion_scheduled_for: null } as never)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { restored: true };
  });
