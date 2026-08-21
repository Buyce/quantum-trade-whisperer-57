# Database regression layer — feasibility spike and results

## 1. Feasibility spike (executed, not assumed)

Goal: decide whether the production migrations can be replayed onto a throwaway
local Postgres, or whether a hand-built schema fixture is required.

Environment: PostgreSQL 17.9 (`initdb`/`pg_ctl`/`psql` present in the image).
`initdb` refuses to run as root and this image has no `useradd`/`su`, so the
cluster is booted inside a user namespace (`unshare -U --map-user=1000`). It
listens on a unix socket only (`listen_addresses=''`).

### First replay attempt — 10 of 50 migrations failed

Blockers, verbatim:

| Blocker | Example error |
|---|---|
| `pg_cron` not installable in this image | `ERROR: extension "pg_cron" is not available … Could not open extension control file ".../pg_cron.control"` |
| `pg_net` (same statement blocks) | aborted with the `pg_cron` statement in the same file |
| Supabase realtime publication missing | `ERROR: publication "supabase_realtime" does not exist` |
| `auth.users` / `auth.uid()` / `auth.jwt()` missing | Supabase-managed `auth` schema is not part of the migrations |
| `private.scanner_config`, `private.kick_scan_worker`, `private.kick_shadow_worker` | cascading failures: the type/table is created in the same file that aborted on `create extension pg_cron` |
| Downstream cascades | `function public.purge_expired_signals() does not exist`, `column "result" of relation "scan_queue" does not exist` — all consequences of the aborted files above |

### Verdict: full replay, with a stubbed platform layer

No hand-written schema fixture was needed. `src/test/db/bootstrap.sql` stubs
**only** the Supabase platform surface — roles (`anon`, `authenticated`,
`service_role`), `auth.users` + `auth.uid()/jwt()/role()` reading
`request.jwt.claims` exactly as GoTrue does, the `supabase_realtime`
publication, and recording no-op stubs for `net.http_post` / `cron.schedule`
so no HTTP request or schedule can leave the cluster.

The only migration text not executed is the two uninstallable extension
statements (5 lines across 3 files, all matching
`create extension … pg_cron|pg_net`), which the harness rewrites to a comment
and reports through `migrationPlan().skipped`. A blocking test asserts that the
skip list contains nothing else. Everything under `public` — tables, indexes,
constraints, GRANTs, RLS policies and RPC bodies — is the production migration
SQL verbatim.

Result after replay: 21 `public` tables and 18 `public` functions, i.e. the
production shape.

## 2. What the layer proves (11 blocking tests)

`src/test/db/__tests__/model-version.db.test.ts`, in the existing `blocking`
Vitest project:

1. `[INVARIANT]` migration replay skips only `pg_cron`/`pg_net` and produces the
   expected production tables.
2. `[INVARIANT]` V1 and V2 `regime_stats` rows coexist under the composite key.
3. `[INVARIANT]` `recompute_regime_stats(1)` deletes/modifies no V2 row.
4. `[INVARIANT]` `recompute_regime_stats(2)` deletes/modifies no V1 row.
5. `[INVARIANT]` version-scoped `regime_stats` reads never return a mixed cohort.
   (Same test also covers `shadow_executions`.)
6. `[INVARIANT]` `claim_scan_job()` returns `run_id`, and the claimed row keeps it.
7. `[INVARIANT]` Tier-0 rows land in `regime_snapshots` prospectively with
   `vol_t1`/`vol_t2` populated and version-scoped.
8. `[INVARIANT]` `anon` cannot read `baseline_snapshots` (permission denied).
9. `[INVARIANT]` an ordinary `authenticated` user cannot read
   `baseline_snapshots` (permission denied).
10. `[INVARIANT]` the authorized `service_role` path still reads it.
11. `[V1_CHARACTERIZATION]` `model_version` still carries `DEFAULT 1` on every
    versioned table, so an insert that omits it lands in V1 instead of failing
    closed. This is the **current** state, pinned rather than changed — no
    schema migration was made in this prompt.

## 3. Operational notes

- The suite fails loudly when no cluster can be started. `PTRADES_DB_TESTS=skip`
  is the only way to bypass it and prints a warning, so a green `verify` can
  never silently mean "DB layer untested".
- Zero broker/MetaApi traffic: fixtures are inserted directly into the local
  cluster; `net.http_post` is a recording stub; the cluster has no TCP listener.
- Teardown: `rm -rf /tmp/ptrades-testpg` (the harness recreates it on demand).
