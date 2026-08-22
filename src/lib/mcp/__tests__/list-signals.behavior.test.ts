/**
 * Prompt 11 closure — BEHAVIOURAL tests for `list_signals`.
 *
 * These drive the real tool body against a fake Supabase client, so retrieval
 * completeness and empty-result wording are proven by behaviour, not by string
 * assertions on the source.
 */
import { describe, expect, it } from "vitest";
import { runListSignals, type SignalsClient } from "../tools/list-signals";

type Row = Record<string, unknown>;

const NOW = Date.parse("2026-08-22T12:00:00.000Z");

interface Tables {
  scanned_signals: Row[];
  market_context: Row[];
  scanner_settings: Row[];
}

/** A minimal, deterministic in-memory stand-in for the Supabase query builder. */
function fakeClient(tables: Tables): SignalsClient {
  function build(table: keyof Tables, columns: string) {
    let rows = (tables[table] ?? []).map((r) => ({ ...r }));
    const join = columns.includes("market_context(");
    const orders: { column: string; ascending: boolean }[] = [];

    const api = {
      eq(column: string, value: string) {
        rows = rows.filter((r) => r[column] === value);
        return api;
      },
      in(column: string, values: string[]) {
        rows = rows.filter((r) => values.includes(r[column] as string));
        return api;
      },
      gte(column: string, value: string) {
        rows = rows.filter((r) => String(r[column]) >= value);
        return api;
      },
      order(column: string, opts: { ascending: boolean }) {
        orders.push({ column, ascending: opts.ascending });
        return api;
      },
      limit(n: number) {
        rows = sorted().slice(0, n);
        orders.length = 0;
        return api;
      },
      range(from: number, to: number) {
        rows = sorted().slice(from, to + 1);
        orders.length = 0;
        return api;
      },
      then<T>(resolve: (value: { data: Row[]; error: null }) => T) {
        const data = sorted().map((r) =>
          join
            ? {
                ...r,
                market_context: tables.market_context
                  .filter((c) => c["signal_id"] === r["id"])
                  .map((c) => ({ trading_session: c["trading_session"] })),
              }
            : r,
        );
        return Promise.resolve(resolve({ data, error: null }));
      },
    };

    function sorted() {
      if (orders.length === 0) return rows;
      return [...rows].sort((a, b) => {
        for (const o of orders) {
          const av = String(a[o.column]);
          const bv = String(b[o.column]);
          if (av !== bv) return (av < bv ? -1 : 1) * (o.ascending ? 1 : -1);
        }
        return 0;
      });
    }

    return api as never;
  }

  return {
    from: (table: string) => ({
      select: (columns: string) => build(table as keyof Tables, columns),
    }),
  } as SignalsClient;
}

const SETTINGS = {
  instruments: ["XAUUSD"],
  sessions: ["london"],
  min_grade: "B",
  alert_min_grade: "A",
  daily_setup_cap: 0,
};

function signal(i: number, overrides: Row = {}): Row {
  return {
    id: `sig-${String(i).padStart(4, "0")}`,
    detected_at: new Date(NOW - i * 60_000).toISOString(),
    instrument: "XAUUSD",
    grade: "A",
    direction: "long",
    status: "active",
    ...overrides,
  };
}

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: { scope: string; count: number; signals: Row[] };
  isError?: boolean;
};

function textOf(result: unknown) {
  return (result as ToolResult).content[0]!.text;
}

function out(result: unknown) {
  const structured = (result as ToolResult).structuredContent;
  if (!structured) throw new Error(`expected a structured result, got: ${textOf(result)}`);
  return structured;
}

describe("list_signals my_scanner retrieval completeness", () => {
  it("[INVARIANT] returns the requested eligible rows behind 250 newer ineligible rows", async () => {
    const noise = Array.from({ length: 250 }, (_, k) => signal(k + 1));
    const eligible = Array.from({ length: 3 }, (_, k) => signal(300 + k));
    const client = fakeClient({
      scanned_signals: [...noise, ...eligible],
      // Newer rows are in a session the user filters out; older ones are london.
      market_context: [
        ...noise.map((r) => ({ signal_id: r["id"], trading_session: "tokyo" })),
        ...eligible.map((r) => ({ signal_id: r["id"], trading_session: "london" })),
      ],
      scanner_settings: [SETTINGS],
    });

    const result = await runListSignals(client, { scope: "my_scanner", limit: 2 }, NOW);
    expect(out(result).count).toBe(2);
    expect(out(result).signals.map((s: Row) => s["id"])).toEqual([
      "sig-0300",
      "sig-0301",
    ]);
  });

  it("[INVARIANT] finds an eligible row behind 200 wrong-instrument rows", async () => {
    const noise = Array.from({ length: 200 }, (_, k) => signal(k + 1, { instrument: "EURUSD" }));
    const target = signal(400);
    const client = fakeClient({
      scanned_signals: [...noise, target],
      market_context: [...noise, target].map((r) => ({
        signal_id: r["id"],
        trading_session: "london",
      })),
      scanner_settings: [SETTINGS],
    });

    const result = await runListSignals(client, { scope: "my_scanner", limit: 5 }, NOW);
    expect(out(result).count).toBe(1);
    expect(out(result).signals[0]["id"]).toBe("sig-0400");
  });

  it("[INVARIANT] min_grade=A with limit 2 returns only A-or-better rows", async () => {
    const rows = [
      signal(1, { grade: "B" }),
      signal(2, { grade: "A" }),
      signal(3, { grade: "C" }),
      signal(4, { grade: "A+" }),
      signal(5, { grade: "A" }),
    ];
    const client = fakeClient({
      scanned_signals: rows,
      market_context: rows.map((r) => ({ signal_id: r["id"], trading_session: "london" })),
      scanner_settings: [SETTINGS],
    });

    const result = await runListSignals(client, { min_grade: "A", limit: 2 }, NOW);
    expect(out(result).signals.map((s: Row) => s["grade"])).toEqual(["A", "A+"]);
  });

  it("[UNIT] defaults to all_published and keeps resolved rows", async () => {
    const rows = [
      signal(1, { status: "resolved", resolved_outcome: "win" }),
      signal(2, { instrument: "EURUSD" }),
    ];
    const client = fakeClient({
      scanned_signals: rows,
      market_context: [],
      scanner_settings: [SETTINGS],
    });

    const result = await runListSignals(client, {}, NOW);
    expect(out(result).scope).toBe("all_published");
    expect(out(result).count).toBe(2);
  });
});

describe("list_signals empty semantics", () => {
  it("[INVARIANT] an empty my_scanner result makes no Capital Preservation claim", async () => {
    const rows = [signal(1, { instrument: "EURUSD" })];
    const client = fakeClient({
      scanned_signals: rows,
      market_context: rows.map((r) => ({ signal_id: r["id"], trading_session: "london" })),
      scanner_settings: [SETTINGS],
    });

    const result = await runListSignals(client, { scope: "my_scanner" }, NOW);
    const text = textOf(result);
    expect(out(result).count).toBe(0);
    expect(text).not.toMatch(/Capital Preservation/i);
    expect(text).not.toMatch(/No Trade/i);
    expect(text).toMatch(/scanner settings/);
  });

  it("[INVARIANT] an empty filtered all_published result makes no Capital Preservation claim", async () => {
    const client = fakeClient({
      scanned_signals: [signal(1)],
      market_context: [],
      scanner_settings: [SETTINGS],
    });

    const result = await runListSignals(client, { instrument: "GBPAUD" }, NOW);
    const text = textOf(result);
    expect(out(result).count).toBe(0);
    expect(text).not.toMatch(/Capital Preservation/i);
    expect(text).not.toMatch(/No Trade/i);
    expect(text).toMatch(/No retained published signals/);
  });
});
