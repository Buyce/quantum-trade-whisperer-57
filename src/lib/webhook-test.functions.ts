/**
 * Webhook payload tester. Builds a dummy B-Grade EURUSD setup IN MEMORY ONLY —
 * nothing is written to scanned_signals — formats it exactly as the live
 * dispatcher would, and POSTs it to the caller's own saved bridge URL so they
 * can verify wiring without waiting for a real market signal.
 *
 * The URL, secret and format are read server-side from the caller's saved
 * settings, so this endpoint can never be used to POST to an arbitrary target.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TEST_TIMEOUT_MS = 8_000;

/** Fixed test setup — deliberately not derived from live data. */
const TEST_SIGNAL = {
  action: "buylimit",
  instrument: "EURUSD",
  entryPrice: "1.15600",
  slPrice: "1.15500",
  tpPrice: "1.15800",
  grade: "B",
} as const;

export function buildTestPineConnectorPayload(licence: string): string {
  return [
    licence,
    TEST_SIGNAL.action,
    TEST_SIGNAL.instrument,
    `entry_price=${TEST_SIGNAL.entryPrice}`,
    `sl_price=${TEST_SIGNAL.slPrice}`,
    `tp_price=${TEST_SIGNAL.tpPrice}`,
  ].join(",");
}

export function buildTestJsonPayload(secret: string | null) {
  return {
    secret,
    event: "test",
    test: true,
    action: TEST_SIGNAL.action,
    instrument: TEST_SIGNAL.instrument,
    grade: TEST_SIGNAL.grade,
    entry_price: Number(TEST_SIGNAL.entryPrice),
    sl_price: Number(TEST_SIGNAL.slPrice),
    tp_price: Number(TEST_SIGNAL.tpPrice),
  };
}

export const sendTestWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: settings, error } = await context.supabase
      .from("scanner_settings")
      .select("webhook_url, webhook_secret, webhook_format")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (error) return { ok: false as const, error: error.message };

    const url = settings?.webhook_url?.trim() ?? "";
    const secret = settings?.webhook_secret?.trim() ?? "";
    const format = settings?.webhook_format === "pineconnector" ? "pineconnector" : "json";

    if (!/^https:\/\//i.test(url)) {
      return { ok: false as const, error: "Save a valid https webhook URL first." };
    }
    if (!secret) {
      return { ok: false as const, error: "Save your webhook secret / licence ID first." };
    }

    const isPine = format === "pineconnector";
    const body = isPine
      ? buildTestPineConnectorPayload(secret)
      : JSON.stringify(buildTestJsonPayload(secret));
    // Preview never echoes the licence/secret back to the browser.
    const preview = isPine
      ? buildTestPineConnectorPayload("[LicenseID]")
      : JSON.stringify(buildTestJsonPayload(null), null, 2);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": isPine ? "text/plain" : "application/json",
          "x-ptrades-idempotency-key": `test-${context.userId}-${Date.now()}`,
        },
        body,
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        return {
          ok: false as const,
          status: res.status,
          preview,
          error: `Your bridge responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        };
      }
      return { ok: true as const, status: res.status, preview, format };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false as const,
        preview,
        error:
          message.includes("timeout") || message.includes("abort")
            ? "Your bridge did not respond within 8 seconds."
            : message,
      };
    }
  });
