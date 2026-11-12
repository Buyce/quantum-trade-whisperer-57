/**
 * Database role checks for the Drizzle-stream migrations 0011 (service-role
 * engine-status twin) and 0012 (scan queue admin-only read). Runs against the
 * replayed legacy + Drizzle migration streams.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { clusterUnavailableReason, ensureCluster, provisionDatabase, type Db } from "../cluster";

const SKIP = process.env["PTRADES_DB_TESTS"] === "skip";
let db: Db;
let unavailable: string | null = null;

beforeAll(() => {
  if (SKIP) {
    unavailable = "PTRADES_DB_TESTS=skip";
    return;
  }
  const cluster = ensureCluster();
  if (!cluster) {
    unavailable = clusterUnavailableReason();
    throw new Error(`[db-tests] no local PostgreSQL cluster could be started: ${unavailable}`);
  }
  db = provisionDatabase(cluster, "enginestatus");
  db.exec(`insert into public.scan_queue (instrument, status) values ('EURUSD', 'pending')`);
}, 300_000);

const guard = () => {
  if (unavailable) expect.unreachable(`db tests unavailable: ${unavailable}`);
};
const user = { sub: "00000000-0000-0000-0000-000000000001", role: "authenticated", email: "someone@example.com" };

describe("engine status and scan queue access", () => {
  it("[INVARIANT] service_role can read the engine status twin", () => {
    guard();
    const rows = db.asRole<{ ok: boolean }>("service_role", "select (public.build_engine_status() is not null) as ok");
    expect(rows[0]?.ok).toBe(true);
  });
  it("[INVARIANT] a signed-in non-admin cannot call the service-role twin", () => {
    guard();
    expect(db.expectFailureAsRole("authenticated", "select public.build_engine_status()", user)).toMatch(/permission denied/);
  });
  it("[INVARIANT] a signed-in non-admin is refused the admin engine status", () => {
    guard();
    expect(db.expectFailureAsRole("authenticated", "select public.get_admin_engine_status()", user)).toMatch(/forbidden|permission denied/);
  });
  it("[INVARIANT] a signed-in non-admin sees no scan queue rows", () => {
    guard();
    let rows: unknown[] = [];
    try {
      rows = db.asRole("authenticated", "select id from public.scan_queue", user);
    } catch (err) {
      expect(String(err)).toMatch(/permission denied/);
    }
    expect(rows).toHaveLength(0);
  });
  it("[INVARIANT] the migration plan includes the Drizzle stream", async () => {
    const { migrationPlan } = await import("../cluster");
    const files = migrationPlan().map((m) => m.file);
    expect(files.some((f) => f.includes("0012_scan_queue_admin_only_read"))).toBe(true);
  });
});
