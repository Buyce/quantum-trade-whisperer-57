/**
 * Bridge connectivity test.
 *
 * Two hard rules, both closures of directly evidenced bypasses:
 *
 *  1. This endpoint MUST NOT emit anything a bridge can interpret as an order.
 *     A PineConnector `buylimit` / `selllimit` line IS an executable order, so
 *     the PineConnector "test" is a LOCAL PREVIEW ONLY with zero outbound
 *     requests — that bridge has no verified non-trading health-check command.
 *     JSON receivers get an explicit `event: "test"` contract instead.
 *  2. The canonical server-side `validateOutboundUrl()` runs immediately before
 *     the request, and the request itself uses `redirect: "manual"`, so a
 *     private / link-local / metadata / redirect-to-private destination can
 *     never be reached. The URL also has to be one that already passed
 *     save-time validation.
 *
 * The URL, secret and format are read server-side from the caller's own saved
 * settings, so this can never be used to POST to an arbitrary target.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TEST_TIMEOUT_MS = 8_000;

/** Fixed test setup — deliberately not derived from live data. */
const TEST_SIGNAL = {
  instrument: "EURUSD",
  entryPrice: "1.15600",
  slPrice: "1.15500",
  tpPrice: "1.15800",
  grade: "B",
} as const;

/**
 * PREVIEW ONLY — never sent. Shown so the trader can see the shape their bridge
 * would receive from the real Prompt-13 dispatcher. The action word is
 * deliberately omitted here; this string is not a valid order.
 */
export function buildTestPineConnectorPreview(): string {
  return [
    "[LicenseID]",
    "<buylimit|selllimit — only ever sent by the execution dispatcher>",
    TEST_SIGNAL.instrument,
    `price=${TEST_SIGNAL.entryPrice}`,
    `sl=${TEST_SIGNAL.slPrice}`,
    `tp=${TEST_SIGNAL.tpPrice}`,
  ].join(",");
}

/** Non-execution JSON contract. `event: "test"` is the whole point. */
export function buildTestJsonPayload(secret: string | null) {
  return {
    secret,
    event: "test",
    test: true,
    executable: false,
    note: "Connectivity test from P-Trades. This is not an order and carries no action or quantity.",
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
      .select("webhook_enabled, webhook_url, webhook_secret, webhook_format, webhook_validated_at")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (error) return { ok: false as const, error: error.message };

    const row = settings as {
      webhook_enabled?: boolean | null;
      webhook_url?: string | null;
      webhook_secret?: string | null;
      webhook_format?: string | null;
      webhook_validated_at?: string | null;
    } | null;

    const url = row?.webhook_url?.trim() ?? "";
    const secret = row?.webhook_secret?.trim() ?? "";
    const format = row?.webhook_format === "pineconnector" ? "pineconnector" : "json";

    if (!secret) {
      return { ok: false as const, error: "Save your webhook secret / licence ID first." };
    }

    // PineConnector: local preview only. No POST, because every command that
    // bridge understands places a real order.
    if (format === "pineconnector") {
      return {
        ok: true as const,
        posted: false as const,
        format,
        preview: buildTestPineConnectorPreview(),
        note: "PineConnector has no verified non-trading health-check command, so this is a local preview only — nothing was sent. Only the execution dispatcher ever posts to that bridge.",
      };
    }

    if (!row?.webhook_enabled || !url) {
      return { ok: false as const, error: "Enable and save your bridge URL first." };
    }
    if (!row.webhook_validated_at) {
      return {
        ok: false as const,
        error: "Your bridge URL has not passed endpoint validation. Save it again first.",
      };
    }

    // Canonical validation, immediately before the request: parse → DNS →
    // public-address classification. Fails closed.
    const { validateOutboundUrl, URL_REJECTION_COPY } = await import(
      "@/lib/delivery/outbound-url.server"
    );
    const verdict = await validateOutboundUrl(url);
    if (!verdict.ok) {
      return {
        ok: false as const,
        posted: false as const,
        error: URL_REJECTION_COPY[verdict.reason],
        reason: verdict.reason,
      };
    }

    const body = JSON.stringify(buildTestJsonPayload(secret));
    // Preview never echoes the secret back to the browser.
    const preview = JSON.stringify(buildTestJsonPayload(null), null, 2);

    try {
      const res = await fetch(verdict.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ptrades-idempotency-key": `test-${context.userId}-${Date.now()}`,
        },
        body,
        // A 30x must never be followed: it is the redirect-to-private bypass.
        redirect: "manual",
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      if (res.status >= 300 && res.status < 400) {
        return {
          ok: false as const,
          posted: true as const,
          status: res.status,
          preview,
          error: "Your bridge redirected the request. Redirects are never followed.",
        };
      }
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        return {
          ok: false as const,
          posted: true as const,
          status: res.status,
          preview,
          error: `Your bridge responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        };
      }
      return { ok: true as const, posted: true as const, status: res.status, preview, format };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false as const,
        posted: true as const,
        preview,
        error:
          message.includes("timeout") || message.includes("abort")
            ? "Your bridge did not respond within 8 seconds."
            : message,
      };
    }
  });
