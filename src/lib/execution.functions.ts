/**
 * Execution & bridge configuration RPCs.
 *
 * The bridge URL is validated SERVER-SIDE (parse → DNS → public-address
 * classification) before it is stored, and the validation stamp is written in
 * the same statement as the URL, so an unvalidated endpoint can never sit in a
 * row that the dispatcher would treat as ready. The dispatcher re-validates at
 * send time regardless — this is the first gate, not the only one.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const bridgeInput = z.object({
  webhookEnabled: z.boolean(),
  webhookUrl: z.string().trim().max(2000),
  webhookSecret: z.string().trim().max(500),
  webhookFormat: z.enum(["json", "pineconnector"]),
  executionEnabled: z.boolean(),
  executionDryRun: z.boolean(),
});

export const saveBridgeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => bridgeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { validateOutboundUrl, URL_REJECTION_COPY } = await import(
      "@/lib/delivery/outbound-url.server"
    );

    let validatedAt: string | null = null;
    let validationReason: string | null = null;
    let host: string | null = null;

    if (data.webhookEnabled || data.executionEnabled) {
      if (!data.webhookUrl) {
        return { ok: false as const, error: "A bridge URL is required." };
      }
      if (!data.webhookSecret) {
        return { ok: false as const, error: "A bridge secret / licence ID is required." };
      }
      const verdict = await validateOutboundUrl(data.webhookUrl);
      if (!verdict.ok) {
        // Fail closed. The previously validated URL keeps working untouched.
        return {
          ok: false as const,
          error: URL_REJECTION_COPY[verdict.reason],
          reason: verdict.reason,
        };
      }
      validatedAt = verdict.validatedAt;
      host = verdict.host;
    }

    // Automated execution requires an explicit bridge; it can never imply one.
    const executionEnabled = data.executionEnabled && data.webhookEnabled;

    const { error } = await context.supabase
      .from("scanner_settings")
      .update({
        webhook_enabled: data.webhookEnabled,
        webhook_url: data.webhookUrl || null,
        webhook_secret: data.webhookSecret || null,
        webhook_format: data.webhookFormat,
        execution_enabled: executionEnabled,
        execution_dry_run: data.executionDryRun,
        webhook_validated_at: validatedAt,
        webhook_validation_reason: validationReason,
      })
      .eq("user_id", context.userId);

    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, host, validatedAt, executionEnabled };
  });

/**
 * Global execution posture, for honest UI copy. Reveals only the two switches
 * and the named policy — never another user's data and never an endpoint URL.
 */
export const getExecutionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { EXECUTION_POLICY_NOTE, DEFAULT_EXECUTION_POLICY } = await import(
      "@/lib/delivery/execution"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("execution_controls")
      .select("live_execution_enabled, force_dry_run, execution_policy, disabled_instruments")
      .maybeSingle();
    const row = data as {
      live_execution_enabled?: boolean;
      force_dry_run?: boolean;
      execution_policy?: string;
      disabled_instruments?: string[];
    } | null;
    return {
      liveEnabled: row?.live_execution_enabled === true,
      forceDryRun: row?.force_dry_run !== false,
      policy: row?.execution_policy ?? DEFAULT_EXECUTION_POLICY,
      policyNote: EXECUTION_POLICY_NOTE,
      disabledInstruments: row?.disabled_instruments ?? [],
    };
  });
