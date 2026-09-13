/**
 * BEHAVIOURAL tests for `list_broker_trades` and the two-cohort performance
 * summary.
 *
 * These pin the bug that shipped: the assistant read only the self-reported
 * journal, so an account with 108 broker-confirmed closed trades was told it had
 * "no trades". The broker record is the authority; an empty journal is never a
 * claim about the user's trading.
 */
import { describe, expect, it } from "vitest";
import { runListBrokerTrades } from "../tools/list-broker-trades";
import { runGetPerformanceSummary } from "../tools/get-performance-summary";

type Row = Record<string, unknown>;

const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

const BROKER: Row[] = [
  {
    state: "closed",
    broker_symbol: "XAUUSD",
    signal_instrument: "XAUUSD",
    exit_at: iso(2),
    r_vs_plan: 2.4,
    r_vs_actual_risk: 2.1,
    gross_profit: 210,
    commission: -3,
    swap: 0,
  },
  {
    state: "closed",
    broker_symbol: "EURUSD",
    signal_instrument: "EURUSD",
    exit_at: iso(5),
    r_vs_plan: -1,
    r_vs_actual_risk: -1,
    gross_profit: -100,
    commission: -2,
    swap: 0,
  },
  {
    state: "closed",
    broker_symbol: "USDJPY",
    signal_instrument: "USDJPY",
    exit_at: iso(40),
    r_vs_plan: 5,
    r_vs_actual_risk: 4.8,
    gross_profit: 480,
    commission: -2,
    swap: 0,
  },
  { state: "open", broker_symbol: "XAUUSD", signal_instrument: "XAUUSD", exit_at: null },
];

/** Minimal in-memory stand-in for the Supabase query builder. */
function fakeClient(tables: Record<string, Row[]>) {
  function build(table: string) {
    let rows = (tables[table] ?? []).map((r) => ({ ...r }));
    const api = {
      select: () => api,
      eq(column: string, value: unknown) {
        rows = rows.filter((r) => r[column] === value);
        return api;
      },
      in(column: string, values: unknown[]) {
        rows = rows.filter((r) => values.includes(r[column]));
        return api;
      },
      or(expr: string) {
        const wanted = expr
          .split(",")
          .map((clause) => clause.split(".eq.")[1])
          .filter(Boolean);
        rows = rows.filter(
          (r) =>
            wanted.includes(String(r["broker_symbol"])) ||
            wanted.includes(String(r["signal_instrument"])),
        );
        return api;
      },
      gte(column: string, value: string) {
        rows = rows.filter((r) => r[column] != null && String(r[column]) >= value);
        return api;
      },
      lte(column: string, value: string) {
        rows = rows.filter((r) => r[column] != null && String(r[column]) <= value);
        return api;
      },
      order(column: string, opts: { ascending: boolean }) {
        rows.sort((a, b) => {
          const av = a[column] == null ? -Infinity : Number(a[column]) || String(a[column]);
          const bv = b[column] == null ? -Infinity : Number(b[column]) || String(b[column]);
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (opts.ascending ? 1 : -1);
        });
        return api;
      },
      limit(n: number) {
        return Promise.resolve({ data: rows.slice(0, n), error: null });
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return api;
  }
  return { from: (table: string) => build(table) } as unknown;
}

describe("list_broker_trades", () => {
  const client = () => fakeClient({ broker_trade_evidence: BROKER, executed_trades: [] });

  it("[INVARIANT] returns the broker-confirmed record with its provenance", async () => {
    const result = await runListBrokerTrades(client(), {});
    const payload = result.structuredContent as { count: number; provenance: string };
    expect(payload.count).toBe(4);
    expect(payload.provenance).toMatch(/broker-derived/);
  });

  it("[UNIT] windows on the broker exit time", async () => {
    const result = await runListBrokerTrades(client(), { days: 14, state: "closed" });
    const payload = result.structuredContent as { count: number; window: string };
    expect(payload.count).toBe(2);
    expect(payload.window).toMatch(/last 14 day/);
  });

  it("[UNIT] orders by R so the best trade is first", async () => {
    const result = await runListBrokerTrades(client(), {
      state: "closed",
      order_by: "r_vs_actual_risk",
    });
    const payload = result.structuredContent as { trades: Row[]; ordered_by: string };
    expect(payload.ordered_by).toBe("r_vs_actual_risk");
    expect(payload.trades[0]?.["broker_symbol"]).toBe("USDJPY");
  });

  it("[UNIT] filters by instrument on either the broker or signal symbol", async () => {
    const result = await runListBrokerTrades(client(), { instrument: "eurusd" });
    const payload = result.structuredContent as { count: number };
    expect(payload.count).toBe(1);
  });

  it("[INVARIANT] an empty result speaks only about the query", async () => {
    const empty = fakeClient({ broker_trade_evidence: [], executed_trades: [] });
    const result = await runListBrokerTrades(empty, { days: 3 });
    const payload = result.structuredContent as { count: number; note: string };
    expect(payload.count).toBe(0);
    expect(payload.note).toMatch(/THIS query only/);
    expect(payload.note).not.toMatch(/No Trade|scanner/i);
  });
});

describe("get_performance_summary cohorts", () => {
  it("[INVARIANT] reports broker-confirmed trades even when the journal is empty", async () => {
    const client = fakeClient({ broker_trade_evidence: BROKER, executed_trades: [] });
    const result = await runGetPerformanceSummary(client, { days: 14 });
    const payload = result.structuredContent as {
      broker_confirmed: { sample_size: number; provenance: string };
      journal_self_reported: { sample_size: number };
      combined: { sample_size: number };
      note: string;
    };
    expect(payload.broker_confirmed.sample_size).toBe(2);
    expect(payload.broker_confirmed.provenance).toMatch(/broker-derived/);
    expect(payload.journal_self_reported.sample_size).toBe(0);
    expect(payload.combined.sample_size).toBe(2);
    expect(payload.note).not.toMatch(/No resolved trades/);
  });

  it("[INVARIANT] keeps the two cohorts separate", async () => {
    const client = fakeClient({
      broker_trade_evidence: BROKER,
      executed_trades: [
        {
          outcome: "win",
          r_vs_plan: 1,
          r_vs_actual_risk: 1,
          realized_r_multiple: null,
          actual_exit_at: iso(1),
          created_at: iso(1),
        },
      ],
    });
    const result = await runGetPerformanceSummary(client, { days: 14 });
    const payload = result.structuredContent as {
      broker_confirmed: { sample_size: number };
      journal_self_reported: { sample_size: number; provenance: string };
      combined: { sample_size: number };
    };
    expect(payload.broker_confirmed.sample_size).toBe(2);
    expect(payload.journal_self_reported.sample_size).toBe(1);
    expect(payload.journal_self_reported.provenance).toMatch(/user-entered/);
    expect(payload.combined.sample_size).toBe(3);
  });

  it("[INVARIANT] a truly empty window never becomes a scanner claim", async () => {
    const client = fakeClient({ broker_trade_evidence: [], executed_trades: [] });
    const result = await runGetPerformanceSummary(client, { days: 7 });
    const payload = result.structuredContent as { note: string };
    expect(payload.note).toMatch(/THIS window only/);
    expect(payload.note).toMatch(/never a claim that the user has never traded/);
  });
});
