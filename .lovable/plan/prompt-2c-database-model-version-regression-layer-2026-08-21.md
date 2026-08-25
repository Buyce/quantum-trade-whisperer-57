# Prompt 2C — Database / Model-Version Regression Layer

Narrow scope: tests, one CI workflow edit, and script naming only. No change to ABC, grading, confidence, entry/stop/target math, replay semantics, learning formulas, alerts, risk policy, or any production trading code. No schema migration, no production row writes, no broker calls.

## 1. Feasibility spike (documented first)

Confirmed already in this sandbox: `postgres`, `initdb`, `pg_ctl`, `psql` are available locally, and 50 migration files exist, 12 of which reference Supabase-only objects (`auth.users`, `auth.uid()`, `auth.jwt()`, the `private` schema and its worker-kick functions, Supabase roles).

The spike runs before any test is written:

1. `initdb` a throwaway cluster under `/tmp`, start it on a free port.
2. Create the roles the migrations assume (`anon`, `authenticated`, `service_role`, `postgres`), a stub `auth` schema with a `users` table and `uid()`/`jwt()` functions, and a `private` schema with no-op `kick_scan_worker`/`kick_shadow_worker`.
3. Replay `supabase/migrations/*.sql` in filename order and record every failure verbatim.

Outcome rule:

- Full replay clean → use it as the test schema.
- Replay fails → record the exact blocker list (file, statement, error) in `docs/DB-TESTS.md`, then build the smallest faithful fixture: the tables under test plus their real indexes, constraints, GRANTs, RLS policies and RPC bodies copied byte-for-byte out of the production migrations. No paraphrased SQL.

Either way, the spike result is reported as a fact, not an assumption.

## 2. Blocking DB tests

One Vitest suite, in the existing `blocking` project, labelled `[INVARIANT]` or `[V1_CHARACTERIZATION]` per the existing taxonomy so the meta-test keeps passing. It skips with a loud notice (never a silent pass) when no local cluster can start.

Model versioning

1. V1 and V2 `regime_stats` rows coexist under the composite key.
2. `recompute_regime_stats(1)` deletes/modifies no `model_version = 2` row.
3. `recompute_regime_stats(2)` deletes/modifies no `model_version = 1` row.
4. Version-scoped regime and shadow reads return only the requested cohort — mixed cohorts are never returned.
5. `claim_scan_job()` returns `run_id` (and the claimed row keeps it) so observations stay pairable.
6. Tier-0 rows are written into `regime_snapshots` prospectively, with `vol_t1`/`vol_t2` present; no historical Tier-0 rows fabricated.

Baseline access control 7. `anon` cannot select `baseline_snapshots`. 8. An ordinary `authenticated` role cannot select `baseline_snapshots`. 9. `service_role` / the authorized server path still reads it successfully.

Missing model version — current state 10. **Verified now:** `model_version` still carries `DEFAULT 1` on `scanned_signals`, `shadow_executions`, `regime_stats`, `regime_snapshots` and `baseline_snapshots`. So this prompt _characterizes_ that an insert omitting `model_version` silently lands in V1, and records it in `docs/CHARACTERISATION.md` as the pin to invert when the expand/contract migration drops the defaults. No schema change here.

## 3. CI and lint clarity

- `.github/workflows/ci.yml`: pin `oven-sh/setup-bun` to `bun-version: 1.3.3` — the exact version this sandbox runs and the one used for the successful local `bun run verify`. `latest` removed.
- Rename the blocking lint script `lint:tests` → `lint:blocking` (same file list) and rename the CI steps so the green gate reads "lint (test sources only) + typecheck + blocking tests + build". The repo-wide `bun run lint` step stays `continue-on-error: true`, retitled to state explicitly that it covers pre-existing formatting debt and that a green `verify` does **not** mean the whole repository lints clean. Same wording added to the workflow header comment.

## 4. Reporting on completion

Feasibility-spike verdict (full replay or fixture + exact blockers); DB test count and per-item result; exact Bun version; full `bun run verify` output; full `bun run test:report` output; GitHub workflow status reported separately as _file changed_ vs _check observed_ (no GitHub remote is visible here, so _check observed_ will be reported as unverified); the changed-file list; and confirmation that no MetaApi/broker request occurred (suite has no network egress; all data is created in the local cluster).

## 5. Files expected to change

- `src/test/db/*` — spike helper, schema bootstrap, one blocking suite
- `docs/DB-TESTS.md` — spike result and blocker inventory
- `docs/CHARACTERISATION.md` — the `model_version` default pin
- `package.json` — `lint:blocking` rename inside `verify`
- `.github/workflows/ci.yml` — pinned Bun version, renamed/documented lint steps

No production source file is touched.
