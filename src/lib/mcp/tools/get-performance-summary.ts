import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { selectR, type RBasis } from "../../journal/r-math";

type TradeRow = {
  outcome: string;
  r_vs_plan: number | null;
  r_vs_actual_risk: number | null;
  realized_r_multiple: number | null;
  actual_exit_at: string | null;
  created_at: string;
};

export type PerformanceWindowArgs = {
  r_basis?: string | undefined;
  /** Look-back in days from now (UTC). Ignored when `from` is given. */
  days?: number | undefined;
  /** ISO start of the window (UTC), inclusive. */
  from?: string | undefined;
  /** ISO end of the window (UTC), inclusive. Defaults to now. */
  to?: string | undefined;
};

/**
 * Resolve an explicit UTC window. A trade is placed in the window by its
 * closure time when known, falling back to its record time — the fallback is
 * reported so the caller can never mistake it for a broker-confirmed close.
 */
function resolveWindow(args: PerformanceWindowArgs): {
  fromMs: number | null;
  toMs: number | null;
  label: string;
  invalid?: string;
} {
  const parse = (value: string | undefined): number | null => {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };

  const explicitFrom = parse(args.from);
  const explicitTo = parse(args.to);
  if (args.from && explicitFrom === null) {
    return { fromMs: null, toMs: null, label: "all time", invalid: `Unreadable 'from' date: ${args.from}` };
  }
  if (args.to && explicitTo === null) {
    return { fromMs: null, toMs: null, label: "all time", invalid: `Unreadable 'to' date: ${args.to}` };
  }

  if (explicitFrom !== null || explicitTo !== null) {
    const toMs = explicitTo ?? Date.now();
    if (explicitFrom !== null && explicitFrom > toMs) {
      return { fromMs: null, toMs: null, label: "all time", invalid: "'from' is after 'to'." };
    }
    return {
      fromMs: explicitFrom,
      toMs,
      label: `${explicitFrom !== null ? new Date(explicitFrom).toISOString() : "start"} to ${new Date(toMs).toISOString()} (UTC)`,
    };
  }

  if (args.days != null) {
    if (!Number.isFinite(args.days) || args.days <= 0) {
      return { fromMs: null, toMs: null, label: "all time", invalid: "'days' must be a positive number." };
    }
    const days = Math.min(Math.floor(args.days), 3650);
    const toMs = Date.now();
    return {
      fromMs: toMs - days * 86_400_000,
      toMs,
      label: `last ${days} day(s) to ${new Date(toMs).toISOString()} (UTC)`,
    };
  }

  return { fromMs: null, toMs: null, label: "all time" };
}

/**
 * The agent and the terminal must agree on the basis, so the basis is an
 * explicit argument and is reported back with every number. Frozen legacy rows
 * are counted separately and never pooled with canonical R.
 */
/** Shared body — the MCP handler and the in-app assistant call this same code. */
export async function runGetPerformanceSummary(
  supabase: unknown,
  args: PerformanceWindowArgs,
) {
  const basis = (args.r_basis ?? "actual_risk") as RBasis;
  const window = resolveWindow(args);
  if (window.invalid) {
    return { content: [{ type: "text" as const, text: window.invalid }], isError: true };
  }
  const db = supabase as ReturnType<typeof supabaseForUser>;
  const { data, error } = await db
    .from("executed_trades")
    .select(
      "outcome, r_vs_plan, r_vs_actual_risk, realized_r_multiple, actual_exit_at, created_at",
    )
    .in("outcome", ["win", "loss", "breakeven"]);

  if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };

  const all = (data ?? []) as TradeRow[];
  const rows: Array<{ outcome: string; r: number }> = [];
  let legacyOnly = 0;
  let datedByRecordTime = 0;
  let outsideWindow = 0;
  for (const row of all) {
    // Placement time: broker-confirmed exit when known, record time otherwise.
    const exitMs = row.actual_exit_at ? Date.parse(row.actual_exit_at) : NaN;
    const usedFallback = !Number.isFinite(exitMs);
    const placedMs = usedFallback ? Date.parse(row.created_at) : exitMs;
    if (window.fromMs !== null || window.toMs !== null) {
      if (!Number.isFinite(placedMs)) {
        outsideWindow += 1;
        continue;
      }
      if (window.fromMs !== null && placedMs < window.fromMs) {
        outsideWindow += 1;
        continue;
      }
      if (window.toMs !== null && placedMs > window.toMs) {
        outsideWindow += 1;
        continue;
      }
      if (usedFallback) datedByRecordTime += 1;
    } else if (usedFallback) {
      datedByRecordTime += 1;
    }

    const r = selectR(row, basis);
    if (r !== null) {
      rows.push({ outcome: row.outcome, r });
    } else if (row.realized_r_multiple != null) {
      legacyOnly += 1;
    }
  }

  const windowFacts = {
    window: window.label,
    trades_outside_window: outsideWindow,
    trades_dated_by_record_time: datedByRecordTime,
  };

  if (rows.length === 0) {
    const payload = {
      sample_size: 0,
      r_basis: basis,
      legacy_only_trades: legacyOnly,
      ...windowFacts,
      note:
        legacyOnly > 0
          ? `No trades in ${window.label} carry a canonical ${basis} R. ${legacyOnly} trade(s) hold frozen legacy R of mixed basis, which is never pooled with canonical R. An empty result means nothing matched THIS window — it is not a statement about the scanner.`
          : `No resolved trades with a canonical R in ${window.label}. An empty result means nothing matched THIS window — it is not a statement about the scanner.`,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
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
    ...windowFacts,
    win_rate: Number((winRate * 100).toFixed(1)),
    average_win_r: Number(avgWin.toFixed(2)),
    average_loss_r: Number(avgLoss.toFixed(2)),
    expectancy_r: Number(expectancy.toFixed(2)),
    note: `All R figures are on the '${basis}' basis, covering ${window.label}. Descriptive only: this is a small dependent sample, not a validated edge estimate.`,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(summary) }],
    structuredContent: summary,
  };
}

export default defineTool({
  name: "get_performance_summary",
  title: "Get performance summary",
  description:
    "Compute the signed-in user's trading performance from their logged trades: sample size, win rate, average win and loss in R, and expectancy in R, optionally restricted to a UTC date window. Choose the R basis explicitly: 'actual_risk' (return against the risk actually taken) or 'plan' (return against the published plan risk). The two bases are never averaged together. Frozen legacy trades are reported separately.",
  inputSchema: {
    r_basis: z
      .enum(["actual_risk", "plan"])
      .default("actual_risk")
      .describe("Which canonical R basis to aggregate. Never mixed."),
    days: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Look-back window in days from now (UTC). Use for 'last 2 weeks' style questions."),
    from: z
      .string()
      .optional()
      .describe("ISO UTC start of the window, inclusive. Overrides 'days'."),
    to: z.string().optional().describe("ISO UTC end of the window, inclusive. Defaults to now."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ r_basis, days, from, to }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return runGetPerformanceSummary(supabaseForUser(ctx), { r_basis, days, from, to });
  },
});
