/**
 * Database / model-version regression layer (Prompt 2C).
 *
 * Every assertion runs against a throwaway local PostgreSQL cluster with the
 * production `supabase/migrations` replayed verbatim (see
 * `src/test/db/cluster.ts` and `docs/DB-TESTS.md`). No production row is
 * written, no schema is changed, and no broker/MetaApi request is possible:
 * the cluster listens on a unix socket and `net.http_post` / `cron.schedule`
 * are recording stubs.
 *
 * When no local cluster can be started the suite fails loudly rather than
 * silently passing, unless PTRADES_DB_TESTS=skip is set explicitly.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  clusterUnavailableReason,
  ensureCluster,
  migrationPlan,
  provisionDatabase,
  type Db,
} from "../cluster";

const SKIP = process.env["PTRADES_DB_TESTS"] === "skip";

let db: Db;
let unavailable: string | null = null;

beforeAll(() => {
  if (SKIP) {
    unavailable = "PTRADES_DB_TESTS=skip";
    // Loud notice: a skipped DB layer must never read as a green DB layer.
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
  db = provisionDatabase(cluster, "modelversion");
}, 300_000);

const guard = () => {
  if (unavailable) expect.unreachable(`db tests unavailable: ${unavailable}`);
};

/** Minimal resolved shadow row; only the columns recompute_regime_stats reads. */
function insertShadow(
  version: number,
  opts: {
    instrument?: string;
    direction?: "long" | "short";
    session?: string;
    vol?: number;
    win?: 0 | 1;
    outcome?: string;
  } = {},
): void {
  const {
    instrument = "EURUSD",
    direction = "long",
    session = "london",
    vol = 1.2,
    win = 1,
    outcome = "tp1",
  } = opts;
  db.exec(`
    insert into public.shadow_executions
      (instrument, grade, direction, detected_at, entry_price, stop_loss, tp1,
       tp2, risk_price, status, resolved_outcome, ml_target_label, realized_r,
       trading_session, volatility_index, model_version)
    values
      ('${instrument}', 'A', '${direction}', now() - interval '2 hours',
       1.1, 1.09, 1.12, 1.13, 0.01, 'resolved', '${outcome}', ${win}, ${win === 1 ? 1.5 : -1},
       '${session}', ${vol}, ${version});
  `);
}

const regime = (version: number) =>
  db.rows<{ tier: number; regime_key: string; n_total: number; model_version: number }>(
    `select tier, regime_key, n_total, model_version from public.regime_stats
      where model_version = ${version} order by tier, regime_key`,
  );

describe("migration replay feasibility", () => {
  it("[INVARIANT] the production migration set replays with only the uninstallable extensions skipped", () => {
    guard();
    const skipped = migrationPlan().flatMap((m) => m.skipped);
    // pg_cron / pg_net are platform extensions; their API is stubbed in bootstrap.sql.
    expect(skipped.every((s) => /pg_cron|pg_net/i.test(s))).toBe(true);
    const tables = db
      .rows<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)
      .map((r) => r.tablename);
    for (const t of [
      "regime_stats",
      "regime_snapshots",
      "shadow_executions",
      "scanned_signals",
      "scan_queue",
      "baseline_snapshots",
      "model_versions",
    ]) {
      expect(tables).toContain(t);
    }
  });
});

describe("model_version cohort isolation", () => {
  it("[INVARIANT] V1 and V2 regime_stats rows coexist under the composite key", () => {
    guard();
    db.exec(`
      insert into public.regime_stats
        (model_version, tier, regime_key, n_total, n_filled, wins, p_fill_shrunk, p_win_shrunk, computed_at)
      values (1, 1, 'global', 10, 5, 3, 0.5, 0.6, now()),
             (2, 1, 'global', 20, 9, 4, 0.45, 0.44, now());
    `);
    const both = db.rows<{ model_version: number }>(
      `select model_version from public.regime_stats where tier = 1 and regime_key = 'global' order by model_version`,
    );
    expect(both.map((r) => r.model_version)).toEqual([1, 2]);
  });

  it("[INVARIANT] recompute_regime_stats(1) deletes and modifies no V2 row", () => {
    guard();
    insertShadow(1);
    insertShadow(2, { instrument: "XAUUSD", vol: 9 });
    db.exec(`select public.recompute_regime_stats(2::smallint)`);
    const v2Before = regime(2);
    expect(v2Before.length).toBeGreaterThan(0);

    db.exec(`select public.recompute_regime_stats(1::smallint)`);
    expect(regime(2)).toEqual(v2Before);
  });

  it("[INVARIANT] recompute_regime_stats(2) deletes and modifies no V1 row", () => {
    guard();
    const v1Before = regime(1);
    expect(v1Before.length).toBeGreaterThan(0);
    db.exec(`select public.recompute_regime_stats(2::smallint)`);
    expect(regime(1)).toEqual(v1Before);
  });

  it("[INVARIANT] version-scoped regime and shadow reads never return a mixed cohort", () => {
    guard();
    for (const v of [1, 2]) {
      const stats = db.rows<{ model_version: number }>(
        `select model_version from public.regime_stats where model_version = ${v}`,
      );
      expect(stats.length).toBeGreaterThan(0);
      expect(new Set(stats.map((r) => r.model_version))).toEqual(new Set([v]));

      const shadow = db.rows<{ model_version: number }>(
        `select model_version from public.shadow_executions where model_version = ${v}`,
      );
      expect(shadow.length).toBeGreaterThan(0);
      expect(new Set(shadow.map((r) => r.model_version))).toEqual(new Set([v]));
    }
  });

  it("[V1_CHARACTERIZATION] model_version still defaults to 1 on production tables, so an omitted version lands in V1 rather than failing closed", () => {
    guard();
    // Pinned present state. When the expand/contract migration drops these
    // defaults this test must be inverted to a fail-closed INVARIANT.
    //
    // `model_observations` and `v2_structure_claims` are deliberately excluded:
    // they are research-only tables whose writers must state the model version
    // explicitly, so those columns have no default and an omitted version fails
    // closed there by design.
    const defaults = db.rows<{ table_name: string; column_default: string | null }>(
      `select table_name, column_default from information_schema.columns
        where table_schema = 'public' and column_name = 'model_version'
          and table_name not in ('model_observations', 'v2_structure_claims')
        order by table_name`,
    );
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults.map((r) => `${r.table_name}=${r.column_default}`)).toEqual(
      defaults.map((r) => `${r.table_name}=1`),
    );

    const research = db.rows<{
      table_name: string;
      column_default: string | null;
      is_nullable: string;
    }>(
      `select table_name, column_default, is_nullable from information_schema.columns
        where table_schema = 'public'
          and table_name in ('model_observations', 'v2_structure_claims')
          and column_name = 'model_version'
        order by table_name`,
    );
    expect(research.length).toBe(2);
    for (const row of research) {
      expect(row.column_default).toBeNull();
      expect(row.is_nullable).toBe("NO");
    }

    db.exec(`
      insert into public.regime_stats
        (tier, regime_key, n_total, n_filled, wins, p_fill_shrunk, p_win_shrunk, computed_at)
      values (9, 'no-version-supplied', 1, 1, 1, 0.5, 0.5, now());
    `);
    const [row] = db.rows<{ model_version: number }>(
      `select model_version from public.regime_stats where regime_key = 'no-version-supplied'`,
    );
    expect(row?.model_version).toBe(1);
  });
});

describe("scan queue claim", () => {
  it("[INVARIANT] claim_scan_job returns the run_id of the claimed job", () => {
    guard();
    const runId = "11111111-2222-3333-4444-555555555555";
    db.exec(
      `insert into public.scan_queue (instrument, run_id) values ('EURUSD', '${runId}'::uuid)`,
    );
    const claimed = db.rows<{ id: number; instrument: string; run_id: string }>(
      `select * from public.claim_scan_job()`,
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.instrument).toBe("EURUSD");
    expect(claimed[0]?.run_id).toBe(runId);

    const [stored] = db.rows<{ status: string; run_id: string }>(
      `select status, run_id from public.scan_queue where id = ${claimed[0]?.id}`,
    );
    expect(stored?.status).toBe("processing");
    expect(stored?.run_id).toBe(runId);
  });
});

describe("regime snapshots", () => {
  it("[INVARIANT] Tier-0 volatility boundaries are preserved prospectively in regime_snapshots", () => {
    guard();
    // Two distinct volatility readings per instrument so terciles are computable.
    insertShadow(1, { vol: 0.4 });
    insertShadow(1, { vol: 2.4, win: 0 });
    insertShadow(1, { vol: 5.5 });
    const [result] = db.rows<{ recompute_regime_stats: { snapshot_tier0_rows: number } }>(
      `select public.recompute_regime_stats(1::smallint) as recompute_regime_stats`,
    );
    expect(result?.recompute_regime_stats.snapshot_tier0_rows).toBeGreaterThan(0);

    const tier0 = db.rows<{ vol_t1: number | null; vol_t2: number | null; model_version: number }>(
      `select vol_t1, vol_t2, model_version from public.regime_snapshots
        where tier = 0 and model_version = 1`,
    );
    expect(tier0.length).toBeGreaterThan(0);
    for (const row of tier0) {
      expect(row.vol_t1).not.toBeNull();
      expect(row.vol_t2).not.toBeNull();
      expect(row.model_version).toBe(1);
    }
  });
});

describe("baseline_snapshots access control", () => {
  it("[INVARIANT] anon cannot read baseline_snapshots", () => {
    guard();
    db.exec(`
      insert into public.baseline_snapshots (kind, model_version, metrics)
      values ('official', 1, '{"data_as_of":"2026-01-01T00:00:00Z"}'::jsonb);
    `);
    const err = db.expectFailureAsRole("anon", `select id from public.baseline_snapshots`);
    expect(err).toMatch(/permission denied/i);
  });

  it("[INVARIANT] an ordinary authenticated user cannot read baseline_snapshots", () => {
    guard();
    const err = db.expectFailureAsRole(
      "authenticated",
      `select id from public.baseline_snapshots`,
      { sub: "00000000-0000-0000-0000-000000000001", role: "authenticated" },
    );
    expect(err).toMatch(/permission denied/i);
  });

  it("[INVARIANT] the authorized service_role path still reads baseline_snapshots", () => {
    guard();
    const rows = db.asRole<{ kind: string }>(
      "service_role",
      `select kind from public.baseline_snapshots`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.kind).toBe("official");
  });
});
