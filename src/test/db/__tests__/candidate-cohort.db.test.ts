/**
 * Database regression layer for the research-candidate cohort (Prompt 7 / 7F).
 *
 * Every assertion runs against a throwaway local PostgreSQL cluster with the
 * production `supabase/migrations` replayed verbatim. What is proved here:
 *
 *  - a synthetic `research_candidate` execution changes no production number —
 *    regime, payoff, the production view and the intelligence RPC;
 *  - a production Replay-V1 plan yields exactly one Replay-V2 sibling and a
 *    candidate plan yields zero;
 *  - a NULL-direction candidate captured twice on retry leaves one row;
 *  - candidate rows and filter-lift results are unreachable to anon and to an
 *    ordinary authenticated user;
 *  - filter lift is pinned to Replay-V1 + `legacy_best_target_touched`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  clusterUnavailableReason,
  ensureCluster,
  provisionDatabase,
  type Db,
} from "../cluster";

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
  db = provisionDatabase(cluster, "candidatecohort");
}, 300_000);

const guard = () => {
  if (unavailable) expect.unreachable(`db tests unavailable: ${unavailable}`);
};

/** One resolved production plan. */
function insertProduction(opts: { instrument?: string; win?: 0 | 1 } = {}): void {
  const { instrument = "EURUSD", win = 1 } = opts;
  db.exec(`
    insert into public.shadow_executions
      (instrument, grade, direction, detected_at, entry_price, stop_loss, tp1, tp2,
       risk_price, status, resolved_outcome, ml_target_label, realized_r, resolved_at,
       trading_session, volatility_index, model_version, cohort, replay_version, execution_policy)
    values ('${instrument}', 'A', 'long', now() - interval '3 days', 1.1, 1.09, 1.12, 1.13,
            0.01, 'resolved', 'tp1', ${win}, ${win === 1 ? 1.5 : -1}, now() - interval '2 days',
            'london', 1.2, 1, 'production', 1, 'legacy_best_target_touched');
  `);
}

/** One resolved research-candidate plan with an extreme R, so contamination would be obvious. */
function insertCandidate(): void {
  db.exec(`
    insert into public.research_candidates
      (instrument, direction, strategy_version, manifest_hash, detected_at, terminal_stage,
       v1_decision, gates, gates_complete, trading_session, volatility_index,
       entry_price, stop_loss, tp1, tp2, tp3, tp1_r, tp2_r, tp3_r, max_r, risk_price, atr, grade)
    values ('EURUSD', 'long', 1, 'hash-a', now() - interval '3 days', 'no_grade',
            'no_trade', '[{"gate":"grade","outcome":"fail"}]'::jsonb, true, 'london', 1.2,
            1.1, 1.09, 1.12, 1.13, 1.14, 1, 2, 3, 3.5, 0.01, 0.004, 'B');
    insert into public.shadow_executions
      (instrument, grade, direction, detected_at, entry_price, stop_loss, tp1, tp2,
       risk_price, status, resolved_outcome, ml_target_label, realized_r, resolved_at,
       trading_session, volatility_index, model_version, cohort, replay_version,
       execution_policy, research_candidate_id)
    values ('EURUSD', 'A', 'long', now() - interval '3 days', 1.1, 1.09, 1.12, 1.13,
            0.01, 'resolved', 'tp3', 1, 99, now() - interval '2 days',
            'london', 1.2, 1, 'research_candidate', 1, 'legacy_best_target_touched',
            (select id from public.research_candidates order by created_at desc limit 1));
  `);
}

const regimeRows = () =>
  db.rows(
    `select tier, regime_key, n_total, n_filled, wins, p_fill_raw, p_win_raw,
            p_fill_shrunk, p_win_shrunk
       from public.regime_stats where model_version = 1 order by tier, regime_key`,
  );

const payoffRows = () =>
  db.rows(
    `select estimand, tier, regime_key, n_used, n_executable, mean_r, sd_r, stat_status
       from public.payoff_stats order by estimand, tier, regime_key`,
  );

describe("research-candidate cohort contamination", () => {
  it("[INVARIANT] a synthetic candidate execution changes zero regime values", () => {
    guard();
    insertProduction();
    insertProduction({ win: 0 });
    db.exec(`select public.recompute_regime_stats(1::smallint)`);
    const before = regimeRows();
    expect(before.length).toBeGreaterThan(0);

    insertCandidate();
    db.exec(`select public.recompute_regime_stats(1::smallint)`);
    // computed_at moves; every statistic must not.
    expect(regimeRows()).toEqual(before);
  });

  it("[INVARIANT] a synthetic candidate execution changes zero payoff values", () => {
    guard();
    db.exec(`select public.recompute_payoff_stats(1::smallint, 1::smallint)`);
    const before = payoffRows();
    expect(before.length).toBeGreaterThan(0);

    insertCandidate();
    db.exec(`select public.recompute_payoff_stats(1::smallint, 1::smallint)`);
    expect(payoffRows()).toEqual(before);
  });

  it("[INVARIANT] the production view never exposes a candidate row", () => {
    guard();
    const [counts] = db.rows<{ candidates: number; view_rows: number; base_rows: number }>(
      `select
         (select count(*)::int from public.shadow_executions where cohort = 'research_candidate') as candidates,
         (select count(*)::int from public.shadow_executions_production) as view_rows,
         (select count(*)::int from public.shadow_executions) as base_rows`,
    );
    expect(counts!.candidates).toBeGreaterThan(0);
    expect(counts!.view_rows).toBe(counts!.base_rows - counts!.candidates);
    const [leak] = db.rows<{ n: number }>(
      `select count(*)::int as n from public.shadow_executions_production
        where cohort <> 'production'`,
    );
    expect(leak!.n).toBe(0);
  });

  it("[INVARIANT] no candidate row is reachable from the live signal surface", () => {
    guard();
    const [signals] = db.rows<{ n: number }>(
      `select count(*)::int as n from public.scanned_signals`,
    );
    expect(signals!.n).toBe(0);
  });
});

describe("Replay-V2 sibling isolation", () => {
  it("[INVARIANT] a production Replay-V1 plan creates exactly one Replay-V2 sibling and a candidate creates none", () => {
    guard();
    db.exec(`update public.shadow_engine_state set replay_v2_shadow_enabled = true where id`);

    const before = db.rows<{ n: number }>(
      `select count(*)::int as n from public.shadow_executions where replay_version = 2`,
    )[0]!.n;

    insertProduction({ instrument: "GBPAUD" });
    const afterProduction = db.rows<{ n: number }>(
      `select count(*)::int as n from public.shadow_executions where replay_version = 2`,
    )[0]!.n;
    expect(afterProduction - before).toBe(1);

    insertCandidate();
    const afterCandidate = db.rows<{ n: number }>(
      `select count(*)::int as n from public.shadow_executions where replay_version = 2`,
    )[0]!.n;
    expect(afterCandidate).toBe(afterProduction);

    const [siblingCohorts] = db.rows<{ n: number }>(
      `select count(*)::int as n from public.shadow_executions
        where replay_version = 2 and cohort <> 'production'`,
    );
    expect(siblingCohorts!.n).toBe(0);

    db.exec(`update public.shadow_engine_state set replay_v2_shadow_enabled = false where id`);
  });
});

describe("candidate capture idempotency", () => {
  it("[INVARIANT] a NULL-direction candidate captured twice in one run leaves exactly one row", () => {
    guard();
    const run = "cccccccc-dddd-eeee-ffff-000000000001";
    const write = () => `
      insert into public.research_candidates
        (run_id, instrument, direction, strategy_version, manifest_hash, detected_at,
         terminal_stage, v1_decision, gates, gates_complete)
      values ('${run}'::uuid, 'XAUUSD', null, 1, 'hash-a', now(), 'm15_neutral',
              'no_trade', '[]'::jsonb, false)
      on conflict do nothing;
    `;
    db.exec(write());
    db.exec(write());
    const [count] = db.rows<{ n: number }>(
      `select count(*)::int as n from public.research_candidates
        where run_id = '${run}'::uuid and direction is null`,
    );
    expect(count!.n).toBe(1);
  });
});

describe("filter lift provenance and access control", () => {
  it("[INVARIANT] filter lift is pinned to the research cohort, Replay-V1 and the legacy execution policy", () => {
    guard();
    const [src] = db.rows<{ definition: string }>(
      `select pg_get_functiondef(oid) as definition from pg_proc
        where proname = 'recompute_filter_lift'`,
    );
    const sql = src!.definition;
    expect(sql).toContain("se.cohort = 'research_candidate'");
    expect(sql).toContain("se.replay_version = 1");
    expect(sql).toContain("se.execution_policy = 'legacy_best_target_touched'");
    // Never a causal claim.
    expect(sql).not.toMatch(/statistically significant/i);
  });

  it("[INVARIANT] recompute_filter_lift runs and labels a thin cohort rather than reporting a result", () => {
    guard();
    const [result] = db.rows<{ recompute_filter_lift: Record<string, unknown> }>(
      `select public.recompute_filter_lift(24) as recompute_filter_lift`,
    );
    const out = result!.recompute_filter_lift;
    expect(out["cohort"]).toBe("research_candidate");
    expect(out["execution_policy"]).toBe("legacy_best_target_touched");
    const rows = db.rows<{ stat_status: string }>(
      `select stat_status from public.filter_lift_stats`,
    );
    for (const row of rows) {
      expect(["unavailable", "insufficient_coverage", "insufficient_sample", "insufficient_clusters"])
        .toContain(row.stat_status);
    }
  });

  it("[INVARIANT] anon cannot read research candidates, candidate executions or filter lift", () => {
    guard();
    for (const table of ["research_candidates", "shadow_executions", "filter_lift_stats"]) {
      const err = db.expectFailureAsRole("anon", `select * from public.${table} limit 1`);
      expect(err).toMatch(/permission denied/i);
    }
  });

  it("[INVARIANT] an ordinary authenticated user cannot read research candidates or filter lift", () => {
    guard();
    for (const table of ["research_candidates", "filter_lift_stats"]) {
      const err = db.expectFailureAsRole(
        "authenticated",
        `select * from public.${table} limit 1`,
        { sub: "00000000-0000-0000-0000-000000000001", role: "authenticated" },
      );
      expect(err).toMatch(/permission denied/i);
    }
  });

  it("[INVARIANT] the service_role path still reads the research tables", () => {
    guard();
    const rows = db.asRole<{ n: number }>(
      "service_role",
      `select count(*)::int as n from public.research_candidates`,
    );
    expect(Number(rows[0]?.n)).toBeGreaterThan(0);
  });

  it("[INVARIANT] both candidate switches are off in the shipped schema", () => {
    guard();
    const [state] = db.rows<{
      candidate_capture_enabled: boolean;
      candidate_enrolment_enabled: boolean;
      candidate_rows_per_run: number;
    }>(
      `select candidate_capture_enabled, candidate_enrolment_enabled, candidate_rows_per_run
         from public.shadow_engine_state`,
    );
    expect(state!.candidate_capture_enabled).toBe(false);
    expect(state!.candidate_enrolment_enabled).toBe(false);
    expect(Number(state!.candidate_rows_per_run)).toBeGreaterThanOrEqual(0);
  });
});
