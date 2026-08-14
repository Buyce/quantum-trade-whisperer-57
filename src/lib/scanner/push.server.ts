/**
 * Web Push delivery (VAPID, aes128gcm) for signal alerts.
 *
 * Runs inside the Cloudflare Worker, so the payload is built with the
 * WebCrypto implementation rather than Node's `web-push`. Every POST is
 * individually aborted after 5s and the fan-out is `Promise.allSettled`, so a
 * slow or dead push service can never hold up a scan job. Endpoints that the
 * push service reports as gone (404/410) are deleted immediately — those are
 * uninstalled apps or revoked permissions and will never work again.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPushPayload } from "@block65/webcrypto-web-push";

export const PUSH_TIMEOUT_MS = 5_000;

export interface PushDevice {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushNotification {
  [key: string]: string | undefined;
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export function vapidKeys() {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] ?? "mailto:alerts@getptrades.com";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

/** Sends one notification and reports whether the endpoint should be dropped. */
async function deliver(device: PushDevice, notification: PushNotification) {
  const vapid = vapidKeys();
  if (!vapid) return { ok: false, gone: false };

  const payload = await buildPushPayload(
    { data: notification, options: { ttl: 1800, urgency: "high" } },
    {
      endpoint: device.endpoint,
      expirationTime: null,
      keys: { p256dh: device.p256dh, auth: device.auth },
    },
    vapid,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(device.endpoint, {
      method: payload.method,
      // The library types `topic`/`urgency` as optional; strip undefined so the
      // object satisfies HeadersInit.
      headers: Object.fromEntries(
        Object.entries(payload.headers).filter((e): e is [string, string] => e[1] !== undefined),
      ),
      body: payload.body as unknown as BodyInit,
      signal: controller.signal,
    });
    return { ok: res.ok, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, gone: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fans a notification out to every device belonging to `userIds`. Never throws:
 * alerts are best-effort and must not fail a scan job.
 */
export async function sendPushToUsers(
  db: SupabaseClient,
  userIds: string[],
  notification: PushNotification,
) {
  if (!userIds.length || !vapidKeys()) return { sent: 0, removed: 0 };

  const { data, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (error || !data?.length) return { sent: 0, removed: 0 };

  const devices = data as PushDevice[];
  const results = await Promise.allSettled(devices.map((d) => deliver(d, notification)));

  const stale: string[] = [];
  let sent = 0;
  results.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    if (result.value.ok) sent += 1;
    const device = devices[i];
    if (result.value.gone && device) stale.push(device.id);
  });

  if (stale.length) {
    await db.from("push_subscriptions").delete().in("id", stale);
  }
  if (sent) {
    const live = devices.filter((d) => !stale.includes(d.id)).map((d) => d.id);
    if (live.length) {
      await db
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .in("id", live);
    }
  }

  return { sent, removed: stale.length };
}
