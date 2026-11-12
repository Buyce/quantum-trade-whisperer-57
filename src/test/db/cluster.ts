/**
 * Local-Postgres harness for the database/model-version regression suite.
 *
 * FEASIBILITY (see docs/DB-TESTS.md): full replay of `supabase/migrations/*.sql`
 * works against a throwaway PostgreSQL 17 cluster once the Supabase platform
 * objects are stubbed (`src/test/db/bootstrap.sql`) and the two
 * `create extension pg_cron/pg_net` statements are skipped — those extensions
 * are not installable in this image. Everything under `public` — tables,
 * indexes, constraints, GRANTs, RLS policies and RPC bodies — comes from the
 * production migrations verbatim, so no app SQL is paraphrased here.
 *
 * No network access and no MetaApi/broker call is possible from this harness:
 * `net.http_post` and `cron.schedule` are recording stubs, and the cluster
 * listens on a unix socket only.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve("supabase/migrations");
const BOOTSTRAP = path.resolve("src/test/db/bootstrap.sql");
const START = path.resolve("src/test/db/start-cluster.sh");

/** Extensions that cannot be installed locally; the stubs already provide the API. */
const SKIPPED_EXTENSION_RE = /^\s*create\s+extension\s+.*\b(pg_cron|pg_net)\b.*;\s*$/i;

export interface Cluster {
  host: string;
  port: string;
}

let cluster: Cluster | null = null;
let clusterError: string | null = null;

/** Boots (or reuses) the throwaway cluster. Returns null when unavailable. */
export function ensureCluster(): Cluster | null {
  if (cluster) return cluster;
  if (clusterError) return null;
  try {
    const out = execFileSync("bash", [START], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // A concurrent worker may hold the cluster lock while it initialises and
      // replays every migration, so allow for a full cold boot plus that wait.
      timeout: 600_000,
    });
    const host = /PGHOST=(\S+)/.exec(out)?.[1];
    const port = /PGPORT=(\S+)/.exec(out)?.[1];
    if (!host || !port) throw new Error(`unexpected start-cluster output: ${out}`);
    cluster = { host, port };
    return cluster;
  } catch (err) {
    clusterError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function clusterUnavailableReason(): string {
  return clusterError ?? "unknown";
}

function psql(c: Cluster, db: string, args: string[], input?: string): string {
  const base = [
    "-h",
    c.host,
    "-p",
    c.port,
    "-U",
    "postgres",
    "-d",
    db,
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-X",
  ];
  return execFileSync("psql", [...base, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PGHOST: c.host, PGPORT: c.port, PGUSER: "postgres", PGPASSWORD: "" },
    ...(input === undefined ? {} : { input }),
  });
}

/** Migration files in apply order, with the two uninstallable extensions skipped. */
const DRIZZLE_DIR = path.resolve("drizzle/migrations");

/**
 * First Drizzle journal idx replayed by the harness. Earlier entries (0000-0009)
 * were written against the live schema, which has drifted from a pure replay of
 * `supabase/migrations` (e.g. 0001 indexes signal_retention_archive.detected_at,
 * a column production has but the legacy replay does not). Lower this bound only
 * after reconciling that drift; never paraphrase a migration to make it apply.
 */
export const DRIZZLE_REPLAY_FROM = 10;

/** Drizzle migrations in journal order; they apply after the legacy stream. */
function drizzleFiles(): string[] {
  try {
    const journal = JSON.parse(
      readFileSync(path.join(DRIZZLE_DIR, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    return [...journal.entries]
      .filter((e) => e.idx >= DRIZZLE_REPLAY_FROM)
      .sort((a, b) => a.idx - b.idx)
      .map((e) => path.join(DRIZZLE_DIR, `${e.tag}.sql`));
  } catch {
    return [];
  }
}

export function migrationPlan(): { file: string; sql: string; skipped: string[] }[] {
  const legacy = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
  return [...legacy, ...drizzleFiles()]
    .map((full) => {
      const file = path.relative(process.cwd(), full);
      const raw = readFileSync(full, "utf8")
        .split("--> statement-breakpoint")
        .join("\n");
      const skipped: string[] = [];
      const sql = raw
        .split("\n")
        .map((line) => {
          if (SKIPPED_EXTENSION_RE.test(line)) {
            skipped.push(line.trim());
            return `-- [test harness] skipped (extension unavailable locally): ${line.trim()}`;
          }
          return line;
        })
        .join("\n");
      return { file, sql, skipped };
    });
}

export interface Db {
  /** Runs SQL, returning nothing. Throws with psql's message on error. */
  exec(sql: string): void;
  /** Runs one query and returns rows as JSON. */
  rows<T = Record<string, unknown>>(sql: string): T[];
  /** Runs a query as the given role, optionally with JWT claims (RLS impersonation). */
  asRole<T = Record<string, unknown>>(
    role: string,
    sql: string,
    claims?: Record<string, unknown>,
  ): T[];
  /** Runs a statement as the given role, optionally with JWT claims. */
  execAsRole(role: string, sql: string, claims?: Record<string, unknown>): void;
  /** Runs SQL expecting it to fail as the owner; returns the error text. */
  expectFailure(sql: string): string;
  /** Same as asRole but expects a failure; returns the error text. */
  expectFailureAsRole(role: string, sql: string, claims?: Record<string, unknown>): string;
}

/** Creates a fresh database with the full production schema replayed into it. */
export function provisionDatabase(c: Cluster, label: string): Db {
  const name = `ptrades_${label}_${Date.now().toString(36)}`;
  psql(c, "postgres", ["-c", `DROP DATABASE IF EXISTS ${name}`]);
  psql(c, "postgres", ["-c", `CREATE DATABASE ${name}`]);
  psql(c, name, ["-f", BOOTSTRAP]);

  const scratch = mkdtempSync(path.join(tmpdir(), "ptrades-mig-"));
  for (const { file, sql } of migrationPlan()) {
    const p = path.join(scratch, file.replace(/[\\/]/g, "__"));
    writeFileSync(p, sql);
    psql(c, name, ["-f", p]);
  }

  const run = (sql: string): string => psql(c, name, ["-t", "-A", "-c", sql]);

  const jsonQuery = (sql: string): string =>
    `select coalesce(json_agg(row_to_json(__t)), '[]'::json)::text from (${sql.replace(/;\s*$/, "")}) __t`;

  const prelude = (role: string, claims?: Record<string, unknown>): string => {
    const claimSql = claims
      ? `select set_config('request.jwt.claims', ${literal(JSON.stringify(claims))}, false);`
      : `select set_config('request.jwt.claims', '', false);`;
    return `${claimSql} set role ${role};`;
  };

  return {
    exec(sql) {
      psql(c, name, ["-c", sql]);
    },
    rows<T>(sql: string) {
      return JSON.parse(run(jsonQuery(sql)).trim() || "[]") as T[];
    },
    asRole<T>(role: string, sql: string, claims?: Record<string, unknown>) {
      const out = psql(c, name, ["-t", "-A", "-c", `${prelude(role, claims)} ${jsonQuery(sql)}`]);
      const lines = out.trim().split("\n").filter(Boolean);
      return JSON.parse(lines[lines.length - 1] ?? "[]") as T[];
    },
    execAsRole(role, sql, claims) {
      psql(c, name, ["-c", `${prelude(role, claims)} ${sql}`]);
    },
    expectFailure(sql) {
      try {
        psql(c, name, ["-v", "ON_ERROR_STOP=1", "-c", sql]);
      } catch (err) {
        const e = err as { stderr?: string; message?: string };
        return `${e.stderr ?? ""}${e.message ?? ""}`;
      }
      throw new Error(`expected failure but statement succeeded: ${sql}`);
    },
    expectFailureAsRole(role, sql, claims) {
      try {
        // Execute the statement directly. Wrapping an UPDATE/INSERT in the
        // read-query JSON adapter would fail on SQL syntax before PostgreSQL
        // reaches the permission boundary this helper is meant to test.
        psql(c, name, ["-c", `${prelude(role, claims)} ${sql}`]);
      } catch (err) {
        const e = err as { stderr?: string; message?: string };
        return `${e.stderr ?? ""}${e.message ?? ""}`;
      }
      throw new Error(`expected failure but query succeeded as ${role}: ${sql}`);
    },
  };
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
