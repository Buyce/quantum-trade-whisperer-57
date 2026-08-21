/**
 * Database regression layer for resolved-trade immutability (Prompt 8/9 closure F).
 *
 * Runs against a throwaway local PostgreSQL cluster with the production
 * `supabase/migrations` replayed verbatim. What is proved here:
 *
 *  - a semantically identical retry of the COMPLETE resolved payload is a no-op;
 *  - a conflicting mutation of ANY member of the resolved payload/provenance set
 *    is rejected by the database with `trade_already_resolved`;
 *  - the creation-time plan snapshot stays immutable;
 *  - frozen legacy R columns can never be written again.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { clusterUnavailableReason, ensureCluster, provisionDatabase, type Db } from "../cluster";

const SKIP = process.env["PTRADES_DB_TESTS"] === "skip";

let db: Db;
let unavailable: string | null = null;

beforeAll(() => {
  if (SKIP) {
    unavailable = "PTRADES_DB_TESTS=skip";
    console.warn("[db-tests] SKIPPED on purpose via PTRADES_DB_TESTS=skip");
    return;
  }
  const cluster = ensureCluster();
  if (!cluster) {
    unavailable = clusterUnavailableReason();
    throw new Error(
      `[db-tests] no local PostgreSQL cluster could be started: ${unavailable}. ` +
        `Set PTRADES_DB_TESTS=skip only if you accept losing this gate.`,
    );
  }
  db = provisionDatabase(cluster, "resolvedimmutability");
}, 300_000);

const guard = () => {
  if (unavailable) expect.unreachable(`db tests unavailable: ${unavailable}`);
};

/** The complete resolved payload written by the web journal / MCP tool. */
const RESOLVED = {
  outcome: "'win'::trade_outcome",
  trade_state: "'resolved'",
  actual_entry_price: "1.1010",
  actual_exit_price: "1.1050",
  actual_initial_stop: "1.0990",
  r_vs_plan: "2.0000",
  r_vs_actual_risk: "2.0000",
  net_r: "null",
  r_availability: "'both'",
  stop_provenance: "'actual_stop'",
  r_math_version: "1",
  verification_level: "'self_reported'",
  price_source: "'human'",
  price_source_client: "null",
  price_recorded_at: "'2026-08-21T10:00:00Z'::timestamptz",
  actual_entry_at: "'2026-08-20T10:00:00Z'::timestamptz",
  actual_exit_at: "'2026-08-20T14:00:00Z'::timestamptz",
  commission: "1.2500",
  swap: "-0.4000",
  cost_currency: "'USD'",
  cost_unit: "'account_currency'",
  broker_ticket: "'T-1'",
  partial_exits: "null",
} as const;

let tradeSeq = 0;

/** Creates one resolved trade with the full payload and returns its id. */
function makeResolvedTrade(): string {
  tradeSeq += 1;
  const id = crypto.randomUUID();
  const signalId = crypto.randomUUID();
  // Journal rows reference a real signal; the plan snapshot is what survives purge.
  db.exec(`
    insert into public.scanned_signals
      (id, detected_at, instrument, grade, direction, entry_price, stop_loss, tp1, tp2,
       atr, rr_ratio, confidence_score, c_alignment, c_rr, c_symmetry, c_volatility,
       pattern_symmetry, qualitative_breakdown)
    values ('${signalId}', now() - interval '2 days', 'EURUSD', 'A', 'long',
            1.1000, 1.0980, 1.1040, 1.1060, 0.0040, 2, 80, 40, 30, 20, 10, 0.9,
            'db test');
  `);
  const cols = Object.keys(RESOLVED).join(", ");
  const vals = Object.values(RESOLVED).join(", ");
  db.exec(`
    insert into public.executed_trades
      (id, user_id, signal_id, user_decision, decision_source,
       planned_entry, planned_stop, planned_direction,
       signal_detected_at, signal_instrument, signal_grade,
       signal_trading_session, signal_time_of_day, signal_day_of_week,
       ${cols})
    values ('${id}', gen_random_uuid(), '${signalId}', 'taken', 'human',
            1.1000, 1.0980, 'long',
            now() - interval '2 days', 'EURUSD', 'A',
            'london', 10, 4,
            ${vals});
  `);
  return id;
}


/** Full identical UPDATE of every protected column. */
function retryIdentical(id: string): void {
  const set = Object.entries(RESOLVED)
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");
  db.exec(`update public.executed_trades set ${set} where id = '${id}'`);
}

describe("resolved-trade immutability", () => {
  it("[INVARIANT] a semantically identical retry of the full payload is accepted as a no-op", () => {
    guard();
    const id = makeResolvedTrade();
    expect(() => retryIdentical(id)).not.toThrow();
    // Twice, because a retry loop must stay safe.
    expect(() => retryIdentical(id)).not.toThrow();
    const [row] = db.rows<{ r_vs_plan: string; outcome: string }>(
      `select r_vs_plan, outcome::text from public.executed_trades where id = '${id}'`,
    );
    expect(Number(row!.r_vs_plan)).toBeCloseTo(2, 4);
    expect(row!.outcome).toBe("win");
  });

  it("[INVARIANT] float noise below 4dp is still an identical retry, not a conflict", () => {
    guard();
    const id = makeResolvedTrade();
    expect(() =>
      db.exec(
        `update public.executed_trades
            set actual_entry_price = 1.10100001, r_vs_plan = 2.000000004
          where id = '${id}'`,
      ),
    ).not.toThrow();
  });

  it("[INVARIANT] every member of the resolved payload/provenance set rejects a conflicting change", () => {
    guard();
    const conflicts: Array<[string, string]> = [
      ["outcome", "'loss'::trade_outcome"],
      ["trade_state", "'open'"],
      ["actual_entry_price", "1.2000"],
      ["actual_exit_price", "1.3000"],
      ["actual_initial_stop", "1.0900"],
      ["r_vs_plan", "9.0000"],
      ["r_vs_actual_risk", "9.0000"],
      ["net_r", "1.5000"],
      ["r_availability", "'plan_only'"],
      ["stop_provenance", "'planned_stop_fallback'"],
      ["r_math_version", "2"],
      ["verification_level", "'plan_verified'"],
      ["price_source", "'agent'"],
      ["price_source_client", "'some-client'"],
      ["price_recorded_at", "'2026-08-22T10:00:00Z'::timestamptz"],
      ["actual_entry_at", "'2026-08-22T10:00:00Z'::timestamptz"],
      ["actual_exit_at", "'2026-08-22T14:00:00Z'::timestamptz"],
      ["commission", "9.9900"],
      ["swap", "9.9900"],
      ["cost_currency", "'EUR'"],
      ["cost_unit", "'points'"],
      ["broker_ticket", "'T-2'"],
      ["partial_exits", `'[{"price":1.104}]'::jsonb`],
      ["user_decision", "'skipped'::decision_kind"],
    ];

    for (const [column, value] of conflicts) {
      const id = makeResolvedTrade();
      let message = "";
      try {
        db.exec(`update public.executed_trades set ${column} = ${value} where id = '${id}'`);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message, `${column} must be rejected on a resolved trade`).toContain(
        "trade_already_resolved",
      );
    }
  });

  it("[INVARIANT] the creation-time plan snapshot stays immutable", () => {
    guard();
    const id = makeResolvedTrade();
    for (const [column, value] of [
      ["planned_entry", "1.5000"],
      ["planned_stop", "1.4000"],
      ["planned_direction", "'short'"],
      ["signal_instrument", "'XAUUSD'"],
      ["signal_grade", "'C'"],
    ] as Array<[string, string]>) {
      let message = "";
      try {
        db.exec(`update public.executed_trades set ${column} = ${value} where id = '${id}'`);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message, `${column} must be immutable`).toContain("journal_snapshot_immutable");
    }
  });

  it("[INVARIANT] frozen legacy R columns can never be written again", () => {
    guard();
    const id = makeResolvedTrade();
    let message = "";
    try {
      db.exec(`update public.executed_trades set realized_r_multiple = 2 where id = '${id}'`);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("legacy_r_frozen");
  });
});
