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
export function resolveWindow(args: PerformanceWindowArgs): {
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
    return {
      fromMs: null,
      toMs: null,
      label: "all time",
      invalid: `Unreadable 'from' date: ${args.from}`,
    };
  }
  if (args.to && explicitTo === null) {
    return {
      fromMs: null,
      toMs: null,
      label: "all time",
      invalid: `Unreadable 'to' date: ${args.to}`,
    };
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
      return {
        fromMs: null,
        toMs: null,
        label: "all time",
        invalid: "'days' must be a positive number.",
      };
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
export async function runGetPerformanceSummary(supabase: unknown, args: PerformanceWindowArgs) {
  const basis = (args.r_basis ?? "actual_risk") as RBasis;
  const window = resolveWindow(args);
  if (window.invalid) {
    return { content: [{ type: "text" as const, text: window.invalid }], isError: true };
  }
  const db = supabase as ReturnType<typeof supabaseForUser>;
  const { data, error } = await db
    .from("executed_trades")
    .select("outcome, r_vs_plan, r_vs_actual_risk, realized_r_multiple, actual_exit_at, created_at")
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

  // [INVARIANT] Broker-confirmed closed trades are the AUTHORITY on what
  // actually happened. The journal above is self-reported and can be empty even
  // when the user traded, so an empty journal must never be reported as "no
  // trades" — the broker cohort is always read as well, and the two cohorts are
  // reported separately so their provenance can never be confused.
  const brokerRows: Array<{ outcome: string; r: number }> = [];
  let brokerOutsideWindow = 0;
  let brokerUnavailableR = 0;
  const { data: brokerData, error: brokerError } = await db
    .from("broker_trade_evidence")
    .select("state, exit_at, r_vs_plan, r_vs_actual_risk, gross_profit, commission, swap")
    .eq("state", "closed");
  if (brokerError) {
    return { content: [{ type: "text" as const, text: brokerError.message }], isError: true };
  }
  for (const row of (brokerData ?? []) as Array<{
    exit_at: string | null;
    r_vs_plan: number | null;
    r_vs_actual_risk: number | null;
    gross_profit: number | null;
    commission: number | null;
    swap: number | null;
  }>) {
    const exitMs = row.exit_at ? Date.parse(row.exit_at) : NaN;
    if (window.fromMs !== null || window.toMs !== null) {
      if (!Number.isFinite(exitMs)) {
        brokerOutsideWindow += 1;
        continue;
      }
      if (window.fromMs !== null && exitMs < window.fromMs) {
        brokerOutsideWindow += 1;
        continue;
      }
      if (window.toMs !== null && exitMs > window.toMs) {
        brokerOutsideWindow += 1;
        continue;
      }
    }
    const r = selectR({ r_vs_plan: row.r_vs_plan, r_vs_actual_risk: row.r_vs_actual_risk }, basis);
    if (r === null) {
      brokerUnavailableR += 1;
      continue;
    }
    const net = (row.gross_profit ?? 0) + (row.commission ?? 0) + (row.swap ?? 0);
    const outcome =
      r > 0 ? "win" : r < 0 ? "loss" : net === 0 ? "breakeven" : net > 0 ? "win" : "loss";
    brokerRows.push({ outcome, r });
  }

  const avg = (list: Array<{ r: number }>) =>
    list.length === 0 ? 0 : list.reduce((s, r) => s + r.r, 0) / list.length;

  const summarize = (list: Array<{ outcome: string; r: number }>) => {
    if (list.length === 0) return { sample_size: 0 };
    const wins = list.filter((r) => r.outcome === "win");
    const losses = list.filter((r) => r.outcome === "loss");
    const winRate = wins.length / list.length;
    const avgWin = avg(wins);
    const avgLoss = Math.abs(avg(losses));
    return {
      sample_size: list.length,
      wins: wins.length,
      losses: losses.length,
      win_rate: Number((winRate * 100).toFixed(1)),
      average_win_r: Number(avgWin.toFixed(2)),
      average_loss_r: Number(avgLoss.toFixed(2)),
      expectancy_r: Number((winRate * avgWin - (1 - winRate) * avgLoss).toFixed(2)),
      total_r: Number(list.reduce((s, r) => s + r.r, 0).toFixed(2)),
    };
  };

  const combined = [...brokerRows, ...rows];
  const payload = {
    r_basis: basis,
    window: window.label,
    broker_confirmed: {
      ...summarize(brokerRows),
      provenance: "broker-derived (broker evidence: broker-reported fills and closes)",
      trades_outside_window: brokerOutsideWindow,
      trades_without_canonical_r: brokerUnavailableR,
    },
    journal_self_reported: {
      ...summarize(rows),
      provenance: "user-entered (self-reported journal; not broker verified)",
      legacy_only_trades: legacyOnly,
      trades_outside_window: outsideWindow,
      trades_dated_by_record_time: datedByRecordTime,
    },
    combined: summarize(combined),
    note:
      combined.length === 0
        ? `No broker-confirmed closed trades and no canonical-R journal trades in ${window.label}. That is a statement about THIS window only — never about the scanner, and never a claim that the user has never traded. Try a wider window, or list_broker_trades without a window, before concluding anything.`
        : `All R figures are on the '${basis}' basis, covering ${window.label}. Broker-confirmed and self-reported cohorts are reported separately and must keep their provenance labels when quoted. Descriptive only: a small dependent sample, not a validated edge estimate.`,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export default defineTool({
  name: "get_performance_summary",
  title: "Get performance summary",
  description:
    "Compute the signed-in user's trading performance from BOTH their broker-confirmed closed trades (the authority) and their self-reported journal, reported as separate cohorts plus a combined view: sample size, win rate, average win and loss in R, and expectancy in R, optionally restricted to a UTC date window. Choose the R basis explicitly: 'actual_risk' (return against the risk actually taken) or 'plan' (return against the published plan risk). The two bases are never averaged together. Frozen legacy trades are reported separately.",
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
