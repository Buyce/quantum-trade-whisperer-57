/**
 * User-reported data integrity audit (owner only).
 *
 * Cross-checks every logged `taken` trade against the deterministic shadow
 * replay for the same signal and against the signal's own geometry. It answers
 * one question: can this reported outcome be reproduced from live market data?
 *
 * ZERO-HALLUCINATION: every flag is derived from live rows. No flags means the
 * panel says so; it never invents findings, and it never writes anything.
 *
 * The learning engine does not read this. Shadow replay labels remain the only
 * training signal.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OWNER_EMAIL = "boatengampomah@gmail.com";

/** Magnitudes a preset button used to produce — unverifiable on their own. */
const PRESET_R_VALUES = [1, 2, -1, 3, -2];

export type UserAuditFlag =
  | "never_filled_in_replay"
  | "r_exceeds_max_r"
  | "preset_r_value"
  | "logged_within_60s"
  | "no_prices_reported"
  | "outcome_disagrees_with_replay"
  | "no_replay_yet";

export interface UserAuditRow {
  tradeId: string;
  signalId: string;
  instrument: string;
  grade: string;
  direction: string;
  detectedAt: string;
  loggedAt: string;
  resolvedAt: string | null;
  outcome: string;
  reportedR: number | null;
  derivedR: number | null;
  hasPrices: boolean;
  replayOutcome: string | null;
  replayR: number | null;
  maxR: number | null;
  missDistanceAtr: number | null;
  flags: UserAuditFlag[];
  /** verified = reproducible, contradicted = replay says impossible. */
  verdict: "verified" | "unverifiable" | "contradicted" | "pending";
}

export interface UserAuditReport {
  generatedAt: string;
  totals: {
    trades: number;
    resolved: number;
    verified: number;
    unverifiable: number;
    contradicted: number;
    pending: number;
    withPrices: number;
    /** Share of resolved rows that are not contradicted, 0-1. */
    trustScore: number | null;
  };
  reportedWinRate: number | null;
  /** Win rate over resolved rows excluding contradicted ones. */
  verifiedWinRate: number | null;
  verifiedSampleN: number;
  flagCounts: Record<string, number>;
  rows: UserAuditRow[];
}

export const getUserReportAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserAuditReport> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    // Shadow tables are service-role only; aggregation stays server-side and
    // returns no user ids.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: trades, error } = await supabaseAdmin
      .from("executed_trades")
      .select(
        "id, signal_id, outcome, realized_r_multiple, derived_r, actual_entry_price, actual_exit_price, created_at, updated_at",
      )
      .eq("user_decision", "taken")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const rowsIn = trades ?? [];
    if (rowsIn.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        totals: {
          trades: 0,
          resolved: 0,
          verified: 0,
          unverifiable: 0,
          contradicted: 0,
          pending: 0,
          withPrices: 0,
          trustScore: null,
        },
        reportedWinRate: null,
        verifiedWinRate: null,
        verifiedSampleN: 0,
        flagCounts: {},
        rows: [],
      };
    }

    const signalIds = [...new Set(rowsIn.map((t) => t.signal_id).filter(Boolean))] as string[];

    const [signalsRes, shadowRes] = await Promise.all([
      supabaseAdmin
        .from("scanned_signals")
        .select("id, instrument, grade, direction, detected_at, max_r, tp2_r")
        .in("id", signalIds),
      supabaseAdmin
        .from("shadow_executions")
        .select("signal_id, status, resolved_outcome, realized_r, miss_distance_atr")
        .in("signal_id", signalIds),
    ]);
    if (signalsRes.error) throw new Error(signalsRes.error.message);
    if (shadowRes.error) throw new Error(shadowRes.error.message);

    const signals = new Map((signalsRes.data ?? []).map((s) => [s.id, s]));
    const shadows = new Map((shadowRes.data ?? []).map((s) => [s.signal_id as string, s]));

    const rows: UserAuditRow[] = [];
    const flagCounts: Record<string, number> = {};

    for (const t of rowsIn) {
      const s = signals.get(t.signal_id);
      if (!s) continue;
      const sh = shadows.get(t.signal_id);
      const flags: UserAuditFlag[] = [];

      const reportedR = t.realized_r_multiple == null ? null : Number(t.realized_r_multiple);
      const derivedR = t.derived_r == null ? null : Number(t.derived_r);
      const hasPrices = t.actual_entry_price != null && t.actual_exit_price != null;
      const open = t.outcome === "open";
      const maxR = s.max_r == null ? null : Number(s.max_r);
      const replayOutcome = sh?.status === "resolved" ? (sh.resolved_outcome ?? null) : null;
      const replayR = sh?.realized_r == null ? null : Number(sh.realized_r);

      if (!open) {
        if (!hasPrices) flags.push("no_prices_reported");
        if (reportedR != null && PRESET_R_VALUES.includes(reportedR) && !hasPrices) {
          flags.push("preset_r_value");
        }
        if (maxR != null && reportedR != null && reportedR > maxR + 1e-9) {
          flags.push("r_exceeds_max_r");
        }
        if (replayOutcome === "never_filled") flags.push("never_filled_in_replay");
        if (
          replayOutcome != null &&
          replayOutcome !== "never_filled" &&
          ((t.outcome === "win" && replayOutcome === "loss") ||
            (t.outcome === "loss" && replayOutcome === "win"))
        ) {
          flags.push("outcome_disagrees_with_replay");
        }
        if (sh == null || sh.status !== "resolved") flags.push("no_replay_yet");

        const loggedMs = new Date(t.updated_at).getTime() - new Date(t.created_at).getTime();
        if (loggedMs >= 0 && loggedMs < 60_000) flags.push("logged_within_60s");
      }

      const contradicted =
        flags.includes("never_filled_in_replay") || flags.includes("r_exceeds_max_r");
      const verdict: UserAuditRow["verdict"] = open
        ? "pending"
        : contradicted
          ? "contradicted"
          : hasPrices && replayOutcome != null && replayOutcome !== "never_filled"
            ? "verified"
            : "unverifiable";

      for (const f of flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;

      rows.push({
        tradeId: t.id,
        signalId: t.signal_id,
        instrument: s.instrument,
        grade: String(s.grade),
        direction: String(s.direction),
        detectedAt: s.detected_at,
        loggedAt: t.created_at,
        resolvedAt: open ? null : t.updated_at,
        outcome: t.outcome,
        reportedR,
        derivedR,
        hasPrices,
        replayOutcome,
        replayR,
        maxR,
        missDistanceAtr: sh?.miss_distance_atr == null ? null : Number(sh.miss_distance_atr),
        flags,
        verdict,
      });
    }

    const resolvedRows = rows.filter((r) => r.verdict !== "pending");
    const contradicted = resolvedRows.filter((r) => r.verdict === "contradicted");
    const verified = resolvedRows.filter((r) => r.verdict === "verified");
    const unverifiable = resolvedRows.filter((r) => r.verdict === "unverifiable");
    const trustworthy = resolvedRows.filter((r) => r.verdict !== "contradicted");

    const winRate = (set: UserAuditRow[]) =>
      set.length === 0 ? null : set.filter((r) => r.outcome === "win").length / set.length;

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        trades: rows.length,
        resolved: resolvedRows.length,
        verified: verified.length,
        unverifiable: unverifiable.length,
        contradicted: contradicted.length,
        pending: rows.length - resolvedRows.length,
        withPrices: rows.filter((r) => r.hasPrices).length,
        trustScore:
          resolvedRows.length === 0 ? null : trustworthy.length / resolvedRows.length,
      },
      reportedWinRate: winRate(resolvedRows),
      verifiedWinRate: winRate(trustworthy),
      verifiedSampleN: trustworthy.length,
      flagCounts,
      rows,
    };
  });
