import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

type TradeRow = { outcome: string; realized_r_multiple: number | null };

export default defineTool({
  name: "get_performance_summary",
  title: "Get performance summary",
  description:
    "Compute the signed-in user's trading performance from their logged trades: sample size, win rate, average win and loss in R, and expectancy in R.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("executed_trades")
      .select("outcome, realized_r_multiple")
      .in("outcome", ["win", "loss", "breakeven"]);

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = ((data ?? []) as TradeRow[]).filter((r) => r.realized_r_multiple !== null);
    if (rows.length === 0) {
      return {
        content: [
          { type: "text", text: "No resolved trades yet — performance metrics are all zero." },
        ],
        structuredContent: { sample_size: 0 },
      };
    }

    const wins = rows.filter((r) => r.outcome === "win");
    const losses = rows.filter((r) => r.outcome === "loss");
    const avg = (list: TradeRow[]) =>
      list.length === 0 ? 0 : list.reduce((s, r) => s + (r.realized_r_multiple ?? 0), 0) / list.length;

    const winRate = wins.length / rows.length;
    const avgWin = avg(wins);
    const avgLoss = Math.abs(avg(losses));
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

    const summary = {
      sample_size: rows.length,
      win_rate: Number((winRate * 100).toFixed(1)),
      average_win_r: Number(avgWin.toFixed(2)),
      average_loss_r: Number(avgLoss.toFixed(2)),
      expectancy_r: Number(expectancy.toFixed(2)),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(summary) }],
      structuredContent: summary,
    };
  },
});
