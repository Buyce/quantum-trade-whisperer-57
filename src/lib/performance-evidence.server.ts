/** Server-only, source-separated broker evidence for the Performance UI. */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Grade } from "@/lib/db-types";
import type { PerformanceEvidenceRow, PerformanceEvidenceSource } from "@/lib/performance-evidence";
import { collectCompletePages } from "@/lib/pagination";

type Db = SupabaseClient<never, never, never>;

interface EvidenceDbRow {
  id: string;
  signal_id: string | null;
  signal_instrument: string | null;
  signal_grade: string | null;
  signal_grade_source: string | null;
  signal_detected_at: string | null;
  signal_trading_session: string | null;
  signal_time_of_day: number | null;
  signal_day_of_week: number | null;
  broker_symbol: string;
  entry_at: string | null;
  resolved_at: string | null;
  first_observed_at: string;
  r_vs_plan: number | null;
  r_vs_actual_risk: number | null;
  volume: number | null;
  entry_price: number | null;
  exit_price: number | null;
  gross_profit: number | null;
  commission: number | null;
  swap: number | null;
  profit_currency: string | null;
  slippage_price: number | null;
  slippage_availability: string | null;
}

interface SignalSnapshot {
  id: string;
  instrument: string;
  grade: string;
  detected_at: string;
}

interface ContextSnapshot {
  signal_id: string;
  trading_session: string;
  time_of_day: number;
  day_of_week: number;
}

const GRADES = new Set<string>(["A+", "A", "B", "C"]);
export const PERFORMANCE_EVIDENCE_PAGE_SIZE = 1_000;
export const PERFORMANCE_EVIDENCE_MAX_PAGES = 10;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fetch a complete, bounded population. Reaching the guard is an error rather
 * than a plausible-looking partial metric; callers then render the existing
 * incomplete-data warning and no source-wide empty claim is made.
 */
export async function collectCompleteEvidencePages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = PERFORMANCE_EVIDENCE_PAGE_SIZE,
  maxPages = PERFORMANCE_EVIDENCE_MAX_PAGES,
): Promise<T[]> {
  return await collectCompletePages({
    fetchPage,
    pageSize,
    maxPages,
    overflowMessage: `Performance evidence exceeded ${pageSize * maxPages} closed rows; refusing incomplete metrics`,
  });
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function loadPerformanceEvidence(
  requestingClient: unknown,
  userId: string,
  source: PerformanceEvidenceSource,
): Promise<PerformanceEvidenceRow[]> {
  // Customer evidence is read through the requesting user's RLS client. The
  // controlled benchmark has no customer owner and is read with service role,
  // then projected into the identifier-free DTO above.
  const db =
    source === "customer"
      ? (requestingClient as Db)
      : ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Db);

  const evidence = await collectCompleteEvidencePages<EvidenceDbRow>(async (from, to) => {
    let evidenceQuery = db
      .from("broker_trade_evidence" as never)
      .select(
        "id, signal_id, signal_instrument, signal_grade, signal_grade_source, signal_detected_at, signal_trading_session, signal_time_of_day, signal_day_of_week, broker_symbol, entry_at, resolved_at, first_observed_at, r_vs_plan, r_vs_actual_risk, volume, entry_price, exit_price, gross_profit, commission, swap, profit_currency, slippage_price, slippage_availability",
      )
      .eq("evidence_class", source)
      .eq("state", "closed")
      .order("resolved_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (source === "customer") evidenceQuery = evidenceQuery.eq("user_id", userId);
    const { data, error } = await evidenceQuery;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EvidenceDbRow[];
  });
  if (evidence.length === 0) return [];

  const signalIds = [...new Set(evidence.map((row) => row.signal_id).filter(Boolean))] as string[];
  const signals = new Map<string, SignalSnapshot>();
  const contexts = new Map<string, ContextSnapshot>();

  if (signalIds.length > 0) {
    // PostgREST `in(...)` URLs become unreliable with thousands of UUIDs. New
    // evidence carries snapshots, but legacy fallbacks are loaded in bounded
    // chunks so an otherwise complete Performance population stays readable.
    for (const ids of chunks(signalIds, 200)) {
      const [signalResult, contextResult] = await Promise.all([
        db
          .from("scanned_signals" as never)
          .select("id, instrument, grade, detected_at")
          .in("id", ids),
        db
          .from("market_context" as never)
          .select("signal_id, trading_session, time_of_day, day_of_week")
          .in("signal_id", ids),
      ]);
      if (signalResult.error) throw new Error(signalResult.error.message);
      if (contextResult.error) throw new Error(contextResult.error.message);
      for (const row of (signalResult.data ?? []) as unknown as SignalSnapshot[]) {
        signals.set(row.id, row);
      }
      for (const row of (contextResult.data ?? []) as unknown as ContextSnapshot[]) {
        contexts.set(row.signal_id, row);
      }
    }
  }

  return evidence.map((row, index) => {
    const signal = row.signal_id ? signals.get(row.signal_id) : undefined;
    const context = row.signal_id ? contexts.get(row.signal_id) : undefined;
    const detectedAt =
      row.signal_detected_at ??
      signal?.detected_at ??
      row.entry_at ??
      row.resolved_at ??
      row.first_observed_at;
    const timestamp = new Date(detectedAt);
    const hour = finite(row.signal_time_of_day ?? context?.time_of_day);
    const day = finite(row.signal_day_of_week ?? context?.day_of_week);
    const snapshottedGrade = row.signal_grade;
    return {
      key: `${source}-${index}`,
      source,
      instrument: row.signal_instrument ?? signal?.instrument ?? row.broker_symbol,
      grade:
        snapshottedGrade && GRADES.has(snapshottedGrade)
          ? (snapshottedGrade as Grade)
          : signal && GRADES.has(signal.grade)
            ? (signal.grade as Grade)
            : "Unknown",
      detectedAt,
      hour: hour ?? timestamp.getUTCHours(),
      dayOfWeek: day ?? timestamp.getUTCDay(),
      session: row.signal_trading_session ?? context?.trading_session ?? "unknown",
      rVsPlan: finite(row.r_vs_plan),
      rVsActualRisk: finite(row.r_vs_actual_risk),
      volume: finite(row.volume),
      entryPrice: finite(row.entry_price),
      exitPrice: finite(row.exit_price),
      grossProfit: finite(row.gross_profit),
      commission: finite(row.commission),
      swap: finite(row.swap),
      // The broker's own net: gross plus its swap and commission. No gross figure
      // means no net figure — never a zero stand-in.
      netProfit:
        finite(row.gross_profit) === null
          ? null
          : (finite(row.gross_profit) ?? 0) + (finite(row.swap) ?? 0) + (finite(row.commission) ?? 0),
      currency: row.profit_currency,
      slippagePrice: finite(row.slippage_price),
      slippageAvailability: row.slippage_availability,
      // Provenance of the grade above: `recovered_from_enqueue_decision` means
      // the setup row was purged and the grade was proved from the surviving
      // decision log. Reported so a recovered grade is never mistaken for a
      // full plan record.
      gradeSource:
        snapshottedGrade && GRADES.has(snapshottedGrade)
          ? row.signal_grade_source === "recovered_from_enqueue_decision"
            ? "recovered_from_enqueue_decision"
            : "delivery"
          : null,
    };
  });
}
