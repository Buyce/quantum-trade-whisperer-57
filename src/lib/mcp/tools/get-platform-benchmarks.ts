import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

/**
 * Platform-wide learning and outcome evidence, aggregated across every
 * connected account.
 *
 * [INVARIANT] Privacy is enforced in the database, not in wording: the
 * `get_platform_benchmarks()` function returns counts, rates and R-multiples
 * only — never a user id, account name, equity, cash P&L or lot size — and
 * withholds cohorts under the minimum group size. No prompt phrasing can widen
 * what this returns.
 */
export async function runGetPlatformBenchmarks(supabase: unknown) {
  const db = supabase as ReturnType<typeof supabaseForUser>;
  const { data, error } = await db.rpc("get_platform_benchmarks");
  if (error) {
    return { content: [{ type: "text" as const, text: error.message }], isError: true };
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export default defineTool({
  name: "get_platform_benchmarks",
  title: "Get platform-wide benchmarks",
  description:
    "Platform-wide learning and outcome evidence aggregated across all connected accounts: broker-verified trade counts, win rates and average R overall and per grade and instrument, published setup counts, shadow-replay coverage and instrument lifecycle stages. Aggregate-only by construction: no account identity, no money amounts, no lot sizes, and cohorts below the minimum group size are withheld. Comparisons against a user's own results are expressed in R-multiples and percentages only. Descriptive, never a forecast.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return runGetPlatformBenchmarks(supabaseForUser(ctx));
  },
});
