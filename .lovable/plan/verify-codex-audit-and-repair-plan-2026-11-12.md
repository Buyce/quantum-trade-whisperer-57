# Verify Codex audit and repair plan

Plan only. No publishing, production settings, orders. The CME futures (Databento) plan is parked as a later batch.

## Verification results

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | Probe green without analysis | Confirmed | Sampler counts `processed` and `idle` as scanner_ok (migration 20260911055753 L120). `worker/process.ts:195` logs `idle` for an empty pass. `processed` only means a job was claimed and finished; that includes stale-discarded jobs. Probe `pipeline.ts` checks only `scanner_ok > 0`. |
| 2 | Weekend calendar mismatch | Confirmed | `ops/freshness.ts:15` uses 22:00; `market-hours.ts isWeekendClosed` uses 21:00. Sun 21:30 → scanner open, probe "market_closed". |
| 3 | Incident clears without recovery | Confirmed | `starvation-watch.server.ts:82` clears on any `isFault=false`; `engine-status.ts` returns idle/isFault=false when zero jobs finished, even on an open market. |
| 4 | Test gate red | Confirmed (1 of 2) | Reproduced here: taxonomy test fails on the unprefixed title at `starvation-watch.test.ts:62` (1 failed / 54 passed). The control-plane timeout did not reproduce and is environment-only. Database suites: Windows has no bash, so they cannot start there. |
| 5 | MCP 19 of 36 tools, all -32603 | Unverified | Needs a live `tools/list` and read-only calls in build mode. The earlier outage cause (PGRST303) is resolved now, so it may have been the cause; that has to be re-tested, not assumed. |
| 6 | DB harness skips drizzle migrations | Confirmed | `src/test/db/cluster.ts:21` replays only `supabase/migrations`; 0011/0012 are untested. Linux build not yet run here. |

## Repairs (priority order: make diagnostics trustworthy first)

**Batch 1 — trustworthy health (P1/P2)**
1. Analysis-progress evidence (F1): the probe reads the newest `scanned_signals`/scan-job evidence of a *completed analysis* (status analysed, including no_trade results), per instrument, within 30 min. It reports liveness (worker passes) and progress (analysed instruments / expected universe) separately. Green only if progress is fresh; partial coverage = 503 `partial` with the missing symbols. Zero setups is still valid. No migration: read from existing tables via the service-role client.
2. Shared calendar (F2): delete `fxMarketClosed`; the probe uses `isWeekendClosed` from `market-hours.ts`. Tests at Fri 20:59/21:00 and Sun 20:59/21:00.
3. Recovery-only clearing (F3): add state `no_observations`. Clear the incident only when `analysed > 0` and the newest analysis is newer than the incident's `opened_at`. A weekend pause neither clears nor opens. Zero observations on an open market keeps the incident open and, if none is open, opens one as `no_observations`. Read opened_at in `clear_starvation_incident` → small drizzle migration 0013 adds `_since timestamptz` guard.
4. Fix test title prefix (F4).

**Batch 2 — coverage**
5. DB harness (F6): `cluster.ts` replays `supabase/migrations` then `drizzle/migrations` in journal order. Add role tests: service_role can call `build_engine_status`; an authenticated non-admin is refused `get_admin_engine_status` and cannot select the scan queue; admin can.
6. Run the full suite plus the Linux production build here. Windows `mcp-js` path bug: report it upstream; no config change unless the Linux build fails too. MCP is never disabled.

**Batch 3 — MCP diagnosis (F5, read-only)**
7. Compare the registry source vs `.lovable/mcp/manifest.json` vs deployed `tools/list` on preview. Call 3 read-only tools (`get_scanner_status`, `list_signals`, `describe_datasets`) and locate the failure: OAuth, dispatch, or data read, using server logs. The 19-tool count probably means the installed connector is on an old published manifest. Fix: publish (needs your approval), then refresh the connector.

## Tests (fail before, pass after)
- Idle-only and stale-only passes → probe 503; analysis with zero setups → 200; 8 of 9 instruments → 503 partial.
- Sun 21:30 UTC → market open on both functions.
- Open incident + empty window → stays open; fresh analysis after opened_at → clears; weekend → unchanged.
- Taxonomy test green.
- DB role tests for 0011/0012.

## Separate verification after build (no single green light)
- Scanner progress: probe 200 + per-instrument analysis times.
- Broker reconciliation: last reconcile pass ok, no "unreadable" failures.
- Signed-in reads: Feed loads in a signed-in preview session.
- MCP: 3 read-only tools return data.

## Rollout / rollback
- Preview first. Migration 0013 only adds a nullable parameter, so it is backward-compatible. To roll back, revert the code; the old RPC signature keeps working.
- The probe may go red after this change where it used to be falsely green. That is intended. Tell the uptime monitor owner.

## Checklist
- [ ] Batch 1 (items 1–4) — recommended first
- [ ] Batch 2 (5–6)
- [ ] Batch 3 (7)
- [ ] Later: Databento CME daily futures for shadow research

## Blockers
- Publishing (your approval) is needed for the probe and MCP manifest to go live on getptrades.com.
- The Windows build fix depends on the `mcp-js` maintainers.
