import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { fetchDayFrame, toEligibilitySignal, type FrameClient } from "@/lib/delivery/day-frame";
import {
  buildCapFrame,
  evaluateEligibility,
  type EligibilitySettings,
} from "@/lib/delivery/eligibility";
import { RETENTION_HOURS } from "@/lib/db-types";

/** Grades at or above the requested tier — applied in SQL, before the limit. */
const GRADE_TIERS = ["C", "B", "A", "A+"] as const;

function gradesAtOrAbove(min: string): string[] {
  const i = GRADE_TIERS.indexOf(min as (typeof GRADE_TIERS)[number]);
  return i < 0 ? [...GRADE_TIERS] : GRADE_TIERS.slice(i);
}

const SELECT =
  "id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2, tp3, rr_ratio, confidence_score, h4_bias, h1_bias, m15_bias, qualitative_breakdown, status, resolved_outcome, resolved_r_multiple";

/** Longest retention any grade enjoys — the horizon beyond which nothing can be eligible. */
const MAX_RETENTION_HOURS = Math.max(...Object.values(RETENTION_HOURS));

/** Rows scanned per page while walking backwards through the retention horizon. */
const PAGE_SIZE = 500;

type QueryResult = { data: Record<string, unknown>[] | null; error: { message: string } | null };

interface Filterable extends PromiseLike<QueryResult> {
  eq(column: string, value: string): Filterable;
  in(column: string, values: string[]): Filterable;
  gte(column: string, value: string): Filterable;
  order(column: string, opts: { ascending: boolean }): Filterable;
  limit(n: number): Filterable;
  range(from: number, to: number): Filterable;
}

/** Minimal structural view of the Supabase client this tool needs. */
export interface SignalsClient {
  from(table: string): { select(columns: string): Filterable };
}

export interface ListSignalsArgs {
  instrument?: string | undefined;
  min_grade?: "A+" | "A" | "B" | "C" | undefined;
  scope?: "all_published" | "my_scanner" | undefined;
  limit?: number | undefined;
}

/**
 * The tool body, extracted so it can be exercised behaviourally against a fake
 * client. `frameClient` defaults to `client`; both are the same Supabase client
 * in production.
 */
export async function runListSignals(
  client: SignalsClient,
  args: ListSignalsArgs,
  now: number = Date.now(),
) {
  const { instrument, min_grade, scope, limit } = args;
  const cap = Math.min(Math.max(limit ?? 10, 1), 50);
  const resolvedScope = scope ?? "all_published";

  // Grade filtering happens in SQL BEFORE the limit, so `limit` counts matching
  // rows. Filtering after the limit silently dropped qualifying setups.
  const baseQuery = () => {
    let query = client.from("scanned_signals").select(SELECT);
    if (instrument) query = query.eq("instrument", instrument.toUpperCase());
    if (min_grade) query = query.in("grade", gradesAtOrAbove(min_grade));
    return query;
  };

  if (resolvedScope === "all_published") {
    const { data, error } = await baseQuery()
      .order("detected_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(cap);
    if (error) return errorResult(error.message);
    return respond(data ?? [], resolvedScope);
  }

  // my_scanner: the user's own eligibility, computed by the SAME shared module
  // the feed and the alert fan-out use. Never a second set of rules.
  const { data: settingsRow, error: settingsError } = await client
    .from("scanner_settings")
    .select("instruments, sessions, min_grade, alert_min_grade, daily_setup_cap")
    .limit(1);
  if (settingsError) return errorResult(settingsError.message);
  const row = (settingsRow ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return errorResult("No scanner settings found for this user.");
  const settings: EligibilitySettings = {
    instruments: (row["instruments"] as string[] | null) ?? [],
    sessions: (row["sessions"] as string[] | null) ?? [],
    min_grade: row["min_grade"] as EligibilitySettings["min_grade"],
    alert_min_grade: (row["alert_min_grade"] ??
      row["min_grade"]) as EligibilitySettings["alert_min_grade"],
    daily_setup_cap: (row["daily_setup_cap"] as number | null) ?? 0,
  };

  let cappedOutIds = new Set<string>();
  try {
    const frame = await fetchDayFrame(client as unknown as FrameClient, now);
    cappedOutIds = buildCapFrame(frame, settings, "feed", now);
  } catch (err) {
    return errorResult(`Eligibility frame unavailable: ${String(err)}`);
  }

  // Complete retrieval: page backwards through the retention horizon in a
  // deterministic (detected_at DESC, id DESC) order until the caller's limit is
  // filled or the horizon is exhausted. No arbitrary pre-eligibility ceiling.
  const horizon = new Date(now - MAX_RETENTION_HOURS * 3_600_000).toISOString();
  const eligible: Record<string, unknown>[] = [];
  for (let page = 0; eligible.length < cap; page += 1) {
    const { data, error } = await baseQuery()
      .gte("detected_at", horizon)
      .order("detected_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) return errorResult(error.message);
    const batch = data ?? [];
    if (batch.length === 0) break;
    const contexts = await sessionsFor(
      client,
      batch.map((r) => r["id"] as string),
    );
    for (const candidate of batch) {
      const signal = toEligibilitySignal({
        ...candidate,
        market_context: contexts.get(candidate["id"] as string) ?? null,
      } as never);
      const verdict = evaluateEligibility({
        signal,
        settings,
        channel: "feed",
        now,
        cappedOutIds,
      });
      if (verdict.eligible) {
        eligible.push(candidate);
        if (eligible.length >= cap) break;
      }
    }
    if (batch.length < PAGE_SIZE) break;
  }

  return respond(eligible, resolvedScope);
}

export default defineTool({
  name: "list_signals",
  title: "List scanned signals",
  description:
    "List trade setups published by the live P-Trades market scanner. Returns real broker-derived rows only. scope='all_published' (default) returns all retained published rows, including retained historical and resolved ones. scope='my_scanner' returns only the rows currently eligible under the signed-in user's feed settings (instruments, sessions, minimum grade), the retention window and their daily cap. An empty result means nothing matched the requested filters and scope — it is NOT evidence about the scanner's current cycle or that no valid setup exists; use get_scanner_status / get_market_status for scanner state.",
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
        "all_published (default) = all retained published rows, retained historical/resolved included. my_scanner = rows currently eligible under this user's feed settings, the retention window and the daily cap (the cap governs feed and alert eligibility, each channel using its own grade threshold).",
      ),
    limit: z.number().int().optional().describe("Maximum rows to return (1-50, default 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ instrument, min_grade, scope, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx) as unknown as SignalsClient;
    return runListSignals(supabase, { instrument, min_grade, scope, limit });
  },
});

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Sessions live in market_context; fetched separately so the main select stays flat. */
async function sessionsFor(
  client: SignalsClient,
  ids: string[],
): Promise<Map<string, { trading_session: string }[]>> {
  const out = new Map<string, { trading_session: string }[]>();
  if (ids.length === 0) return out;
  const { data } = await client
    .from("market_context")
    .select("signal_id, trading_session")
    .in("signal_id", ids);
  for (const row of data ?? []) {
    out.set(row["signal_id"] as string, [
      { trading_session: row["trading_session"] as string },
    ]);
  }
  return out;
}

/**
 * Truthful, scope-specific empty semantics. An empty filtered list is never
 * described as the scanner having found no setup.
 */
function respond(rows: Record<string, unknown>[], scope: string) {
  const empty =
    scope === "my_scanner"
      ? "No currently eligible signals match your scanner settings, requested filters, retention window and daily cap."
      : "No retained published signals match the requested filters.";
  return {
    content: [
      {
        type: "text" as const,
        text: rows.length === 0 ? empty : JSON.stringify(rows),
      },
    ],
    structuredContent: { scope, count: rows.length, signals: rows },
  };
}
