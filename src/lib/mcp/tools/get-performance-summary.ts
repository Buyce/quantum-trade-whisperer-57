import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { selectR, type RBasis } from "../../journal/r-math";

type TradeRow = {
  outcome: string;
  r_vs_plan: number | null;
  r_vs_actual_risk: number | null;
  realized_r_multiple: number | null;
};

/**
 * The agent and the terminal must agree on the basis, so the basis is an
 * explicit argument and is reported back with every number. Frozen legacy rows
 * are counted separately and never pooled with canonical R.
 */
export default defineTool({
  name: "get_performance_summary",
  title: "Get performance summary",
  description:
    "Compute the signed-in user's trading performance from their logged trades: sample size, win rate, average win and loss in R, and expectancy in R. Choose the R basis explicitly: 'actual_risk' (return against the risk actually taken) or 'plan' (return against the published plan risk). The two bases are never averaged together. Frozen legacy trades are reported separately.",
  inputSchema: {
    r_basis: z
      .enum(["actual_risk", "plan"])
      .default("actual_risk")
      .describe("Which canonical R basis to aggregate. Never mixed."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ r_basis }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const basis = (r_basis ?? "actual_risk") as RBasis;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("executed_trades")
      .select("outcome, r_vs_plan, r_vs_actual_risk, realized_r_multiple")
      .in("outcome", ["win", "loss", "breakeven"]);

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const all = (data ?? []) as TradeRow[];
    const rows: Array<{ outcome: string; r: number }> = [];
    let legacyOnly = 0;
    for (const row of all) {
      const r = selectR(row, basis);
      if (r !== null) {
        rows.push({ outcome: row.outcome, r });
      } else if (row.realized_r_multiple != null) {
        legacyOnly += 1;
      }
    }

    if (rows.length === 0) {
      const payload = {
        sample_size: 0,
        r_basis: basis,
        legacy_only_trades: legacyOnly,
        note:
          legacyOnly > 0
            ? `No trades carry a canonical ${basis} R yet. ${legacyOnly} trade(s) hold frozen legacy R of mixed basis, which is never pooled with canonical R.`
            : "No resolved trades with a canonical R yet.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }

    const wins = rows.filter((r) => r.outcome === "win");
    const losses = rows.filter((r) => r.outcome === "loss");
    const avg = (list: Array<{ r: number }>) =>
      list.length === 0 ? 0 : list.reduce((s, r) => s + r.r, 0) / list.length;

    const winRate = wins.length / rows.length;
    const avgWin = avg(wins);
    const avgLoss = Math.abs(avg(losses));
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

    const summary = {
      sample_size: rows.length,
      r_basis: basis,
      legacy_only_trades: legacyOnly,
      win_rate: Number((winRate * 100).toFixed(1)),
      average_win_r: Number(avgWin.toFixed(2)),
      average_loss_r: Number(avgLoss.toFixed(2)),
      expectancy_r: Number(expectancy.toFixed(2)),
      note: `All R figures are on the '${basis}' basis. Descriptive only: this is a small dependent sample, not a validated edge estimate.`,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(summary) }],
      structuredContent: summary,
    };
  },
});
