import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { fetchDayFrame, toEligibilitySignal, type FrameClient } from "@/lib/delivery/day-frame";
import {
  buildCapFrame,
  evaluateEligibility,
  type EligibilitySettings,
} from "@/lib/delivery/eligibility";

/** Grades at or above the requested tier — applied in SQL, before the limit. */
const GRADE_TIERS = ["C", "B", "A", "A+"] as const;

function gradesAtOrAbove(min: string): string[] {
  const i = GRADE_TIERS.indexOf(min as (typeof GRADE_TIERS)[number]);
  return i < 0 ? [...GRADE_TIERS] : GRADE_TIERS.slice(i);
}

const SELECT =
  "id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, rr_ratio, confidence_score, h4_bias, h1_bias, m15_bias, qualitative_breakdown, status, resolved_outcome, resolved_r_multiple";

export default defineTool({
  name: "list_signals",
  title: "List scanned signals",
  description:
    "List the most recent trade setups produced by the live P-Trades market scanner. Returns real broker-derived signals only; an empty list means the scanner is in Capital Preservation Mode (no valid setup). Scope defaults to all_published (every published setup, including historical and resolved ones); pass scope='my_scanner' to see only the setups the signed-in user's own scanner settings make eligible today.",
  inputSchema: {
    instrument: z
      .string()
      .optional()
      .describe("Optional instrument filter, e.g. XAUUSD, GBPAUD or EURUSD."),
    min_grade: z
      .enum(["A+", "A", "B", "C"])
      .optional()
      .describe("Only return setups at or above this grade tier."),
    scope: z
      .enum(["all_published", "my_scanner"])
      .optional()
      .describe(
        "all_published (default) = every published setup, historical and resolved included. my_scanner = only what this user's instrument/session/grade filters and daily cap deliver.",
      ),
    limit: z.number().int().optional().describe("Maximum rows to return (1-50, default 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ instrument, min_grade, scope, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const cap = Math.min(Math.max(limit ?? 10, 1), 50);
    const resolvedScope = scope ?? "all_published";

    // Grade filtering happens in SQL BEFORE the limit, so `limit` counts matching
    // rows. Filtering after the limit silently dropped qualifying setups.
    let query = supabase.from("scanned_signals").select(SELECT);
    if (instrument) query = query.eq("instrument", instrument.toUpperCase());
    if (min_grade) query = query.in("grade", gradesAtOrAbove(min_grade));

    if (resolvedScope === "all_published") {
      const { data, error } = await query.order("detected_at", { ascending: false }).limit(cap);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      const rows = data ?? [];
      return respond(rows, resolvedScope);
    }

    // my_scanner: the user's own eligibility, computed by the SAME shared module
    // the feed and the alert fan-out use. Never a second set of rules.
    const { data: settingsRow, error: settingsError } = await supabase
      .from("scanner_settings")
      .select("instruments, sessions, min_grade, alert_min_grade, daily_setup_cap")
      .maybeSingle();
    if (settingsError) {
      return { content: [{ type: "text", text: settingsError.message }], isError: true };
    }
    if (!settingsRow) {
      return {
        content: [{ type: "text", text: "No scanner settings found for this user." }],
        isError: true,
      };
    }
    const settings: EligibilitySettings = {
      instruments: settingsRow.instruments ?? [],
      sessions: settingsRow.sessions ?? [],
      min_grade: settingsRow.min_grade,
      alert_min_grade: settingsRow.alert_min_grade ?? settingsRow.min_grade,
      daily_setup_cap: settingsRow.daily_setup_cap ?? 0,
    };

    const now = Date.now();
    let cappedOutIds = new Set<string>();
    try {
      const frame = await fetchDayFrame(supabase as unknown as FrameClient, now);
      cappedOutIds = buildCapFrame(frame, settings, "feed", now);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Eligibility frame unavailable: ${String(err)}` }],
        isError: true,
      };
    }

    const { data, error } = await query
      .order("detected_at", { ascending: false })
      .limit(Math.max(cap * 4, 200));
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const contexts = await sessionsFor(supabase, (data ?? []).map((r) => r.id));
    const rows = (data ?? [])
      .filter((row) => {
        const signal = toEligibilitySignal({
          ...(row as Record<string, unknown>),
          market_context: contexts.get(row.id) ?? null,
        } as never);
        return evaluateEligibility({ signal, settings, channel: "feed", now, cappedOutIds })
          .eligible;
      })
      .slice(0, cap);

    return respond(rows, resolvedScope);
  },
});

/** Sessions live in market_context; fetched separately so the main select stays flat. */
async function sessionsFor(
  supabase: ReturnType<typeof supabaseForUser>,
  ids: string[],
): Promise<Map<string, { trading_session: string }[]>> {
  const out = new Map<string, { trading_session: string }[]>();
  if (ids.length === 0) return out;
  const { data } = await supabase
    .from("market_context")
    .select("signal_id, trading_session")
    .in("signal_id", ids);
  for (const row of data ?? []) {
    out.set(row.signal_id, [{ trading_session: row.trading_session }]);
  }
  return out;
}

function respond(rows: unknown[], scope: string) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          rows.length === 0
            ? "No signals match. The scanner found no qualifying setup (Capital Preservation Mode)."
            : JSON.stringify(rows),
      },
    ],
    structuredContent: { scope, count: rows.length, signals: rows },
  };
}
