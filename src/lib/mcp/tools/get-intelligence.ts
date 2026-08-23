import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import {
  MIN_N_FILL,
  MIN_N_WIN,
  lookupRegime,
  tierLabel,
  type RegimeStatRow,
} from "@/lib/learning/regime";
import { explainRegime } from "@/lib/learning/explain";
import { ACTIVE_MODEL_LABEL, ACTIVE_MODEL_VERSION } from "@/lib/versioning";

export default defineTool({
  name: "get_intelligence",
  title: "Get learning intelligence",
  description:
    "Read descriptive, hierarchically shrunk replay rates for a setup: fill rate, TP1-if-filled rate, their joint rate, sample sizes, which tier answered, reporting-gate status, the shrinkage ladder and descriptive feature associations. These are in-sample replay summaries, not forecasts, expected return or a live track record. Pass a signal_id, or an explicit instrument/direction/session bucket.",
  inputSchema: {
    signal_id: z.string().optional().describe("Signal id from list_signals."),
    instrument: z.string().optional().describe("XAUUSD, GBPAUD or EURUSD."),
    direction: z.string().optional().describe("long or short."),
    session: z
      .string()
      .optional()
      .describe("sydney, tokyo, london, london_new_york_overlap or new_york."),
    volatility_index: z
      .number()
      .optional()
      .describe("ATR-derived volatility index for the bucket."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    let instrument = input.instrument;
    let direction = input.direction;
    let session = input.session;
    let volatilityIndex = input.volatility_index ?? null;

    if (input.signal_id) {
      const { data: signal, error } = await supabase
        .from("scanned_signals")
        .select("instrument, direction, market_context(trading_session, volatility_index)")
        .eq("id", input.signal_id)
        .maybeSingle();
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      if (!signal) {
        return {
          content: [{ type: "text", text: `No signal ${input.signal_id} found.` }],
          isError: true,
        };
      }
      const rawContext = (signal as { market_context: unknown }).market_context;
      const context = (Array.isArray(rawContext) ? rawContext[0] : rawContext) as
        { trading_session: string; volatility_index: number | null } | null | undefined;
      instrument = signal.instrument;
      direction = signal.direction;
      session = context?.trading_session ?? session;
      volatilityIndex =
        context?.volatility_index == null ? volatilityIndex : Number(context.volatility_index);
    }

    if (!instrument || !direction || !session) {
      return {
        content: [
          {
            type: "text",
            text: "Provide either signal_id, or instrument, direction and session.",
          },
        ],
        isError: true,
      };
    }

    const { data, error } = await supabase
      .from("regime_stats")
      .select(
        "tier, regime_key, instrument, direction, session, vol_bucket, n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2, computed_at",
      )
      // Production cohort only: an agent must never be handed statistics that
      // mix the live model with a research model.
      .eq("model_version", ACTIVE_MODEL_VERSION);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (data ?? []) as unknown as RegimeStatRow[];
    const query = { instrument, direction, session, volatilityIndex };
    const prior = lookupRegime(rows, query);

    if (!prior) {
      const payload = {
        model_version: ACTIVE_MODEL_VERSION,
        model_label: ACTIVE_MODEL_LABEL,
        learned: false,
        message:
          "The learning engine has no global statistics yet: not enough resolved shadow samples. No estimate is available.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }

    const explanation = explainRegime(rows, query);

    const payload = {
      model_version: ACTIVE_MODEL_VERSION,
      model_label: ACTIVE_MODEL_LABEL,
      learned: true,
      query,
      prior: {
        p_fill: prior.pFill,
        p_win_if_filled: prior.pWin,
        // Deprecated compatibility keys retain their numeric value. The labels
        // below prevent clients from presenting an in-sample replay rate as a
        // calibrated forecast or expected return.
        expected_value: prior.pJoint,
        expected_value_deprecated: true,
        expected_value_semantics: "descriptive_p_fill_times_p_tp1_if_filled_replay_rate",
        joint_win_probability: prior.pJoint,
        joint_win_probability_deprecated: true,
        joint_replay_rate: prior.pJoint,
        interpretation:
          "descriptive_in_sample_replay_rate_not_forecast_expected_return_or_live_track_record",
        expected_r: null,
        expected_r_status: "not_available_admin_research_only",
        prior_status: prior.status,
        prior_reason: prior.reason,
        sample_n: prior.sampleN,
        filled_n: prior.filledN,
        tier: prior.tier,
        tier_label: tierLabel(prior.tier),
        fill_gate_passed: prior.fillGatePassed,
        win_gate_passed: prior.winGatePassed,
        tier3_skipped_n: prior.tier3SkippedN,
      },
      gates: {
        fill_gate_requires_resolved_samples: MIN_N_FILL,
        win_gate_requires_filled_samples: MIN_N_WIN,
        status:
          prior.fillGatePassed && prior.winGatePassed
            ? "active"
            : "advisory — replay rates are displayed only and do not alter grading or alerts",
      },
      shrinkage_ladder: explanation?.ladder ?? [],
      feature_influence: explanation?.features ?? [],
      leans_on: explanation?.leansOn ?? null,
      volatility_bucket: explanation?.bucket ?? null,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
