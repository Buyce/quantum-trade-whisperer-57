/**
 * "Explain this setup" — Lovable AI explains a signal, market snapshot or a
 * trader's own rationale. Rule conflicts are computed in code first
 * (src/lib/explain/rules.ts); the model explains, it never decides, and it
 * never places or changes orders.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkRules, type ExplainSetup, type RuleCheck } from "@/lib/explain/rules";

const Input = z.object({
  signalId: z.string().uuid().nullable(),
  text: z.string().max(6000).nullable(),
});

export interface SetupExplanation {
  summary: string;
  riskFactors: string[];
  ruleChecks: RuleCheck[];
  ruleNotes: string;
  dataGaps: string[];
}

export const explainSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<SetupExplanation> => {
    if (!data.signalId && !data.text?.trim()) throw new Error("Provide a signal or some text.");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI explanations are not configured.");
    const db = context.supabase;

    let setup: ExplainSetup = {
      instrument: null, direction: null, grade: null, entry: null, stop: null, target: null,
    };
    let signalFacts: Record<string, unknown> | null = null;
    if (data.signalId) {
      const { data: s, error } = await db
        .from("scanned_signals")
        .select("instrument, direction, grade, entry_price, stop_loss, tp1, rr_ratio, confidence_score, detected_at")
        .eq("id", data.signalId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!s) throw new Error("Signal not found.");
      signalFacts = s;
      setup = {
        instrument: s.instrument, direction: s.direction, grade: s.grade,
        entry: Number(s.entry_price), stop: Number(s.stop_loss), target: Number(s.tp1),
      };
    }

    const [{ data: settings }, cohort] = await Promise.all([
      db
        .from("scanner_settings")
        .select("instruments, min_grade, max_stop_loss_percent, risk_per_trade_percent")
        .eq("user_id", context.userId)
        .maybeSingle(),
      setup.instrument && setup.direction
        ? db
            .from("auto_cohort_policies")
            .select("policy, risk_share_percent")
            .eq("user_id", context.userId)
            .eq("instrument", setup.instrument)
            .eq("direction", setup.direction)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const ruleChecks = checkRules(setup, settings ?? null, cohort.data ?? null);

    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText, Output } = await import("ai");
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    const prompt = [
      "Explain this trading setup for a retail forex trader in plain language.",
      "Use ONLY the facts given. If something needed is missing, list it under dataGaps — never invent prices, news or statistics.",
      "Do not recommend taking or skipping the trade. Keep summary under 120 words, 3-6 risk factors, ruleNotes under 80 words explaining the rule checks.",
      signalFacts ? `P-Trades signal (engine-derived): ${JSON.stringify(signalFacts)}` : "",
      data.text ? `Trader-provided notes / snapshot (self-reported, unverified):\n${data.text}` : "",
      `Rule checks computed by P-Trades from the trader's settings: ${JSON.stringify(ruleChecks)}`,
    ].filter(Boolean).join("\n\n");

    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        prompt,
        output: Output.object({
          schema: z.object({
            summary: z.string(),
            riskFactors: z.array(z.string()),
            ruleNotes: z.string(),
            dataGaps: z.array(z.string()),
          }),
        }),
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      const out = await result.output;
      return {
        summary: out.summary,
        riskFactors: out.riskFactors.slice(0, 8),
        ruleNotes: out.ruleNotes,
        dataGaps: out.dataGaps.slice(0, 8),
        ruleChecks,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/402/.test(msg)) throw new Error("AI credits are used up. Add credits to continue.");
      if (/429/.test(msg)) throw new Error("Too many requests right now. Try again in a minute.");
      console.error("explainSetup failed", msg);
      throw new Error("The AI explanation could not be generated. Try again later.");
    }
  });
