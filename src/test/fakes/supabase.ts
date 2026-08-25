/**
 * Minimal recording fake of the Supabase query builder.
 *
 * Purpose: assert what our server modules ASK the database for — cohort
 * predicates, budgets, execution policy, insert payloads, ordering — without a
 * network, without a cluster and without any production row. It deliberately
 * does not emulate Postgres: statements that need real SQL semantics are
 * covered by the DB-test layer instead.
 */
export interface FakeCall {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  columns: string | null;
  eq: Record<string, unknown>;
  is: Record<string, unknown>;
  notIs: string[];
  in: Record<string, unknown[]>;
  neq: Record<string, unknown>;
  or: string[];
  gte: Record<string, unknown>;
  range: { from: number; to: number } | null;
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
  payload: Record<string, unknown> | null;
  single: boolean;
}

export interface FakeResult {
  data?: unknown;
  error?: { message: string } | null;
}

export type FakeHandler = (call: FakeCall) => FakeResult;
export type FakeRpcHandler = (fn: string, args: unknown) => FakeResult;

export interface FakeSupabase {
  client: unknown;
  calls: FakeCall[];
  rpcCalls: { fn: string; args: unknown }[];
}

export function createFakeSupabase(
  handler: FakeHandler = () => ({ data: [], error: null }),
  rpcHandler: FakeRpcHandler = () => ({ data: true, error: null }),
): FakeSupabase {
  const calls: FakeCall[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];

  function builder(table: string, op: FakeCall["op"], payload: Record<string, unknown> | null) {
    const call: FakeCall = {
      table,
      op,
      columns: null,
      eq: {},
      is: {},
      notIs: [],
      in: {},
      neq: {},
      or: [],
      gte: {},
      range: null,
      order: null,
      limit: null,
      payload,
      single: false,
    };
    calls.push(call);

    const settle = () => {
      const r = handler(call);
      return { data: r.data ?? null, error: r.error ?? null };
    };

    const api = {
      select(columns?: string) {
        call.columns = columns ?? "*";
        return api;
      },
      eq(column: string, value: unknown) {
        call.eq[column] = value;
        return api;
      },
      is(column: string, value: unknown) {
        call.is[column] = value;
        return api;
      },
      neq(column: string, value: unknown) {
        call.neq[column] = value;
        return api;
      },
      not(column: string, op2: string, _value: unknown) {
        if (op2 === "is") call.notIs.push(column);
        return api;
      },
      or(expression: string) {
        call.or.push(expression);
        return api;
      },
      gte(column: string, value: unknown) {
        call.gte[column] = value;
        return api;
      },
      range(from: number, to: number) {
        call.range = { from, to };
        const r = settle();
        return Promise.resolve({ data: r.data, error: r.error });
      },
      in(column: string, values: unknown[]) {
        call.in[column] = values;
        return api;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        call.order = { column, ascending: opts?.ascending ?? true };
        return api;
      },
      limit(n: number) {
        call.limit = n;
        return api;
      },
      maybeSingle() {
        call.single = true;
        const r = settle();
        const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return Promise.resolve({ data, error: r.error });
      },
      then<T>(onFulfilled: (value: { data: unknown; error: unknown }) => T) {
        return Promise.resolve(settle()).then(onFulfilled);
      },
    };
    return api;
  }

  const client = {
    from(table: string) {
      return {
        select: (columns?: string) => builder(table, "select", null).select(columns),
        insert: (payload: Record<string, unknown>) => builder(table, "insert", payload),
        upsert: (payload: Record<string, unknown>) => builder(table, "insert", payload),
        update: (payload: Record<string, unknown>) => builder(table, "update", payload),
        delete: () => builder(table, "delete", null),
      };
    },
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      const r = rpcHandler(fn, args);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };

  return { client, calls, rpcCalls };
}
