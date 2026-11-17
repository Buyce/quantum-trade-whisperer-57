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
  const raw = (data ?? {}) as Record<string, unknown>;
  // The database aggregate reads the SELF-REPORTED journal (executed_trades) but
  // names its block `broker_verified_trades`. Relabel here (additive: the old key
  // stays for compatibility) so no caller presents journal figures as broker truth.
  const payload: Record<string, unknown> = {
    ...raw,
    journal_trades: raw.broker_verified_trades ?? null,
    trades_provenance:
      "self-reported journal (user-entered prices; NOT broker verified). The legacy key broker_verified_trades is a mislabel of the same journal block and must not be quoted as broker-verified.",
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export default defineTool({
  name: "get_platform_benchmarks",
  title: "Get platform-wide benchmarks",
  description:
    "Platform-wide learning and outcome evidence aggregated across all connected accounts: self-reported journal trade counts, win rates and average R overall and per grade and instrument (user-entered, NOT broker verified), published setup counts, shadow-replay coverage and instrument lifecycle stages. Aggregate-only by construction: no account identity, no money amounts, no lot sizes, and cohorts below the minimum group size are withheld. Comparisons against a user's own results are expressed in R-multiples and percentages only. Descriptive, never a forecast.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return runGetPlatformBenchmarks(supabaseForUser(ctx));
  },
});
