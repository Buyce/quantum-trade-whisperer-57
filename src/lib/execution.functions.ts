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
import { resolveWriteOnlySecret } from "@/lib/delivery/write-only-secret";
import { z } from "zod";

const bridgeInput = z.object({
  webhookEnabled: z.boolean(),
  webhookUrl: z.string().trim().max(2000),
  webhookSecret: z.string().trim().max(500),
  webhookFormat: z.enum(["json", "pineconnector"]),
  executionEnabled: z.boolean(),
  executionDryRun: z.boolean(),
  /**
   * Dedicated owner confirmation for the dry-run → live transition. An ordinary
   * settings save is NEVER sufficient to arm live execution, and the
   * confirmation is only honoured while live execution is actually available
   * system-wide, so nobody can pre-arm and become live later in silence.
   */
  confirmLiveExecution: z.boolean().optional(),
  /**
   * Opt-in only. When false (the default) the journal-derived exposure figure is
   * advisory and never blocks a delivery.
   */
  exposureLimitEnabled: z.boolean().optional(),
});

export const saveBridgeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => bridgeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { validateOutboundUrl, URL_REJECTION_COPY } =
      await import("@/lib/delivery/outbound-url.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Credential reads and every execution-authorisation write are server-only.
    // An empty input means "keep the saved secret"; the browser never receives
    // the existing value merely so it can echo it back on an ordinary save.
    const { data: currentRow, error: credentialError } = await supabaseAdmin
      .from("scanner_settings")
      .select("webhook_secret")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (credentialError) return { ok: false as const, error: credentialError.message };
    const existingSecret =
      (currentRow as { webhook_secret?: string | null } | null)?.webhook_secret?.trim() ?? "";
    const { effective: effectiveSecret, replacement: submittedSecret } = resolveWriteOnlySecret(
      data.webhookSecret,
      existingSecret,
    );

    let validatedAt: string | null = null;
    const validationReason: string | null = null;
    let host: string | null = null;

    if (data.webhookEnabled || data.executionEnabled) {
      if (!data.webhookUrl) {
        return { ok: false as const, error: "A bridge URL is required." };
      }
      if (!effectiveSecret) {
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

    // ---- Live arming gate ---------------------------------------------------
    // Turning dry-run OFF is a distinct, explicitly confirmed act, and it is only
    // accepted while live execution is genuinely available system-wide. Without
    // this, a user could pre-arm live and silently start trading the moment an
    // operator flipped the global switch.
    let liveRequested = executionEnabled && data.executionDryRun === false;
    if (liveRequested) {
      if (data.confirmLiveExecution !== true) {
        return {
          ok: false as const,
          error:
            "Live execution needs its own confirmation. Tick the live-execution confirmation box to arm it; saving settings is not enough.",
        };
      }
      const { data: controls } = await supabaseAdmin
        .from("execution_controls")
        .select("live_execution_enabled, force_dry_run")
        .maybeSingle();
      const row = controls as { live_execution_enabled?: boolean; force_dry_run?: boolean } | null;
      const globallyLive = row?.live_execution_enabled === true && row?.force_dry_run !== true;
      if (!globallyLive) {
        return {
          ok: false as const,
          error:
            "Live execution is not available system-wide right now, so it cannot be armed in advance. Dry run stays on; confirm live again once live execution is available.",
        };
      }
    }

    const confirmedAt = liveRequested ? new Date().toISOString() : null;

    const settingsPatch: Record<string, unknown> = {
      webhook_enabled: data.webhookEnabled,
      webhook_url: data.webhookUrl || null,
      webhook_format: data.webhookFormat,
      execution_enabled: executionEnabled,
      execution_dry_run: !liveRequested,
      exposure_limit_enabled: data.exposureLimitEnabled === true,
      webhook_validated_at: validatedAt,
      webhook_validation_reason: validationReason,
      // Confirmation state is part of the execution configuration identity and
      // is cleared whenever the user is not explicitly arming live execution.
      live_execution_confirmed_at: confirmedAt,
      live_execution_confirmed_host: liveRequested ? host : null,
      live_execution_confirmed_global_live: liveRequested,
      live_execution_confirmed_version: null,
    };
    // Blank is preservation, not deletion. This avoids breaking an existing
    // bridge merely because a write-only field is empty on an unrelated save.
    if (submittedSecret) settingsPatch["webhook_secret"] = submittedSecret;

    const { error } = await supabaseAdmin
      .from("scanner_settings")
      .update(settingsPatch as never)
      .eq("user_id", context.userId);

    if (error) return { ok: false as const, error: error.message };

    // The configuration version is bumped by a DB trigger on the columns that
    // authorize a delivery. Report it back so the UI can show that queued
    // orders from the previous configuration will no longer be sent.
    const { data: after } = await supabaseAdmin
      .from("scanner_settings")
      .select("execution_config_version")
      .eq("user_id", context.userId)
      .maybeSingle();
    const configVersion =
      (after as { execution_config_version?: number } | null)?.execution_config_version ?? null;

    // Pin the confirmation to the configuration version it was given for. Any
    // later configuration change bumps the version, so the stale confirmation
    // stops authorizing live orders until it is given again.
    if (liveRequested && configVersion !== null) {
      const { error: pinError } = await supabaseAdmin
        .from("scanner_settings")
        .update({ live_execution_confirmed_version: configVersion } as never)
        .eq("user_id", context.userId);
      if (pinError) {
        liveRequested = false;
        return { ok: false as const, error: pinError.message };
      }
    }

    return {
      ok: true as const,
      host,
      validatedAt,
      executionEnabled,
      liveArmed: liveRequested,
      configVersion,
      webhookSecretConfigured: effectiveSecret.length > 0,
    };
  });

/**
 * Global execution posture, for honest UI copy. Reveals only the two switches
 * and the named policy — never another user's data and never an endpoint URL.
 */
export const getExecutionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { EXECUTION_POLICY_NOTE, DEFAULT_EXECUTION_POLICY } =
      await import("@/lib/delivery/execution");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [controlsResult, credentialResult] = await Promise.all([
      supabaseAdmin
        .from("execution_controls")
        .select(
          "live_execution_enabled, force_dry_run, execution_policy, disabled_instruments, demo_auto_enabled, live_auto_enabled",
        )
        .maybeSingle(),
      supabaseAdmin
        .from("scanner_settings")
        .select("webhook_secret")
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);
    const data = controlsResult.data;
    const row = data as {
      live_execution_enabled?: boolean;
      force_dry_run?: boolean;
      execution_policy?: string;
      disabled_instruments?: string[];
      demo_auto_enabled?: boolean;
      live_auto_enabled?: boolean;
    } | null;
    return {
      liveEnabled: row?.live_execution_enabled === true,
      forceDryRun: row?.force_dry_run !== false,
      policy: row?.execution_policy ?? DEFAULT_EXECUTION_POLICY,
      policyNote: EXECUTION_POLICY_NOTE,
      disabledInstruments: row?.disabled_instruments ?? [],
      // Automatic-order capabilities are separate switches and default to OFF, so
      // the UI can only offer arming when the capability genuinely exists now.
      demoAutoEnabled: row?.demo_auto_enabled === true,
      liveAutoEnabled: row?.live_auto_enabled === true,
      webhookSecretConfigured:
        !credentialResult.error &&
        Boolean(
          (
            credentialResult.data as { webhook_secret?: string | null } | null
          )?.webhook_secret?.trim(),
        ),
    };
  });

/**
 * Your own most recent automatic-order decisions.
 *
 * This exists so that "no automatic orders yet" is never ambiguous: either the
 * engine decided and this says what it decided, or there is no decision at all
 * and the UI says exactly that instead of implying a refusal.
 *
 * Reads through the request-scoped client, so RLS returns only rows belonging to
 * the caller plus the system-wide rows that concern no single user.
 */
export const getAutoOrderDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("execution_enqueue_decisions")
      .select("created_at, instrument, grade, decision, detail, enqueued, filtered")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      at: String(row["created_at"]),
      instrument: (row["instrument"] as string | null) ?? null,
      grade: (row["grade"] as string | null) ?? null,
      decision: String(row["decision"]),
      detail: (row["detail"] as string | null) ?? null,
      enqueued: Number(row["enqueued"] ?? 0),
      filtered: Number(row["filtered"] ?? 0),
    }));
  });

/**
 * Seven-day gate-impact readout for the caller.
 *
 * WHAT IT IS. A count of every automatic-order decision recorded for you in the
 * last seven UTC days, grouped by what decided it. It answers "which of my own
 * rules is refusing the most", nothing more.
 *
 * WHAT IT IS NOT. It is not a performance statistic and says nothing about
 * whether a refused setup would have won or lost. A refusal is not a missed
 * profit, and this readout must never be read that way.
 */
export const getGateImpactReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sinceMs = Date.now() - 7 * 24 * 60 * 60_000;
    const since = new Date(sinceMs).toISOString();
    const { data, error } = await context.supabase
      .from("execution_enqueue_decisions")
      .select("decision, enqueued, filtered, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as {
      decision: string;
      enqueued: number | null;
      filtered: number | null;
    }[];
    const byDecision = new Map<string, number>();
    let enqueued = 0;
    let filtered = 0;
    for (const row of rows) {
      byDecision.set(row.decision, (byDecision.get(row.decision) ?? 0) + 1);
      enqueued += Number(row.enqueued ?? 0);
      filtered += Number(row.filtered ?? 0);
    }
    return {
      since,
      // True when the seven-day window is full of rows and older ones were cut,
      // so the caller is never told a truncated sample is the whole picture.
      truncated: rows.length >= 1000,
      considered: rows.length,
      enqueued,
      filtered,
      reasons: [...byDecision.entries()]
        .map(([decision, count]) => ({ decision, count }))
        .sort((a, b) => b.count - a.count),
    };
  });
