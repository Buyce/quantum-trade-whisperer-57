import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const GRADE_RANK: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1 };

export default defineTool({
  name: "list_signals",
  title: "List scanned signals",
  description:
    "List the most recent trade setups produced by the live P-Trades market scanner. Returns real broker-derived signals only; an empty list means the scanner is in Capital Preservation Mode (no valid setup).",
  inputSchema: {
    instrument: z
      .string()
      .optional()
      .describe("Optional instrument filter, e.g. XAUUSD, GBPAUD or EURUSD."),
    min_grade: z
      .enum(["A+", "A", "B", "C"])
      .optional()
      .describe("Only return setups at or above this grade tier."),
    limit: z.number().int().optional().describe("Maximum rows to return (1-50, default 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ instrument, min_grade, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const cap = Math.min(Math.max(limit ?? 10, 1), 50);
    let query = supabase
      .from("scanned_signals")
      .select(
        "id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, rr_ratio, confidence_score, h4_bias, h1_bias, m15_bias, qualitative_breakdown, status, resolved_outcome, resolved_r_multiple",
      )
      .order("detected_at", { ascending: false })
      .limit(cap);
    if (instrument) query = query.eq("instrument", instrument.toUpperCase());

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (data ?? []).filter((row) => {
      if (!min_grade) return true;
      const grade = (row as { grade?: string }).grade ?? "";
      return (GRADE_RANK[grade] ?? 0) >= (GRADE_RANK[min_grade] ?? 0);
    });

    return {
      content: [
        {
          type: "text",
          text:
            rows.length === 0
              ? "No signals match. The scanner found no qualifying setup (Capital Preservation Mode)."
              : JSON.stringify(rows),
        },
      ],
      structuredContent: { count: rows.length, signals: rows },
    };
  },
});
