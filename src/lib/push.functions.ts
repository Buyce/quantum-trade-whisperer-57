/**
 * Push subscription server functions.
 *
 * The VAPID public key is safe to hand to the browser (it is the verification
 * half of the pair) but it lives in server env, so it is fetched rather than
 * inlined. Subscriptions are written with the caller's own RLS-scoped client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface PushDeviceRow {
  id: string;
  endpoint: string;
  user_agent: string | null;
  last_success_at: string | null;
  created_at: string;
}

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
  userAgent: z.string().max(300).optional(),
});

/** Public: the browser needs the VAPID public key before it can subscribe. */
export const getPushConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ publicKey: string | null }> => {
    return { publicKey: process.env["VAPID_PUBLIC_KEY"] ?? null };
  },
);

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => subscriptionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.from("push_subscriptions" as never).upsert(
      {
        user_id: context.userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.userAgent ?? null,
        failure_count: 0,
      } as never,
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ endpoint: z.string().max(2000) }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("push_subscriptions" as never)
      .delete()
      .eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPushDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PushDeviceRow[]> => {
    const { data, error } = await context.supabase
      .from("push_subscriptions" as never)
      .select("id, endpoint, user_agent, last_success_at, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PushDeviceRow[];
  });

/** Sends a test notification to every device registered by the caller. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ sent: number; removed: number }> => {
    const { sendPushToUsers } = await import("@/lib/scanner/push.server");
    return sendPushToUsers(context.supabase, [context.userId], {
      title: "P-Trades Hub — test alert",
      body: "Push notifications are working. Real setups will arrive here within seconds of publication.",
      url: "/feed",
      tag: "ptrades-test",
    });
  });
