# P-Trades incident recovery, full audit, and recovery options

Goal: while ticket SU-545069 is open, produce evidence-backed answers and a tested recovery path. Nothing is published, cut over, or allowed to trade.

## Deliverables (saved to Files)
1. `P-Trades_Audit_2026-11.md`: prioritised findings. Each finding lists impact, evidence (file:line, log, or repro), whether it is confirmed or inferred, the repair, and how to verify it.
2. `P-Trades_Public_Projects_Comparison.md`: linked public examples, with notes on what to reuse, what to adapt, and what to avoid.
3. `P-Trades_Recovery_Runbook.md`: the three recovery paths, my recommendation (now / after recovery / not yet), step-by-step cutover and rollback, and a single-dispatcher proof.
4. A chat summary listing the remaining blockers and who can clear each one.

## Step 1: Access and incident evidence
- Inventory the tools available in this session. Separate the ones I actually used from catalogue options, and prove each with a harmless read or name what blocked it.
- Ownership of the backend: report only what the project info and tool responses show. If that doesn't settle it, mark ownership unverified.
- Direct SQL reads (these bypass the failing data service): check the latest real completion in the scanner pass log, the latest reconciliation result per account, the newest stored signal, and the cron run history. Explain why a cron run marked "succeeded" is not proof that the work finished.
- Backup timestamp: I can't read backups. You will read the newest time from More → Database → Backups.
- Re-test the data service with a fresh sign-in, and record the request IDs.
- Finish the preview checks: typecheck, the full test suite, and the production build. Then use Playwright to confirm that tapping Feed Retry sends a new network request.

## Step 2: Full system audit (read-only tracing)
Trace the whole path: sign-in → market data → scanner → publication → eligibility and risk → order queue and send → reconciliation → History/Performance → MCP/assistant. Cover migrations, grants and access rules, cron jobs, monitoring, environment configuration, test coverage, and what users see when data is stale, empty, or unavailable. Compare the result against the README and operations docs.
I'll pay special attention to:
- Silent worker failures (cron reports success while the worker failed).
- Lost reconciliation evidence.
- Signals that stay up after they're stale.
- Duplicate-order risk.
- The scanner's dependence on the data service even when it runs with the server key.

## Step 3: Public-project research
- Search for Lovable-built trading, broker, or MCP apps and for comparable open-source projects (Supabase cron pipelines, MetaApi/MT5 bots, self-hosted Supabase, moves off Supabase).
- Cite only public, inspectable sources. Label each one as a demo or a production system. If no close Lovable example exists, I'll say so.

## Step 4: Recovery options
Paths A, B and C are compared on what transfers, what must be rebuilt, recovery time (with the basis for each estimate), data preservation, ongoing maintenance, and rollback.
- **A. Repair the current backend.** Support upgrades the data service or fixes its clock.
- **B. Restore to a separate Supabase.** Use the database export, then reconfigure sign-in, secrets, and cron.
- **C. Keep PostgreSQL, replace the Supabase services.** The workers would use a direct database connection.
- **Candidate ideas:**
  - A worker health check that writes to the database without the data service and alerts when no scan has completed in 30 minutes.
  - A "dispatch owner" lease row, so only one environment can send orders.
  - A fallback so workers that can't reach the data service read and write through direct SQL.
  - An external uptime check on a real scanner-completion timestamp.
  Each idea comes with the failure it prevents, its running cost, and the smallest experiment that could validate it.

## Step 5: Safe implementation (preview only)
- Fix whatever Step 1 or 2 confirms on the app side, for example: workers report real failures instead of a success status, a scanner-staleness alarm, and the dispatch-owner lease, which stays off until enabled.
- Add a focused test for each rule.
- Run the typecheck, the tests, and the build.
- Rehearse an isolated restore only if a separate backend is actually available. If it is, broker sending and scheduled jobs stay disabled there.
- I will not publish, rotate credentials, change trading settings, bypass authorisation, create trading data, or place orders.

## Known limits up front
- I have no tool that reads the backup list, the data-service version, or the dashboard owner. These stay with you or Supabase support.
- An isolated Supabase rehearsal (path B) needs a separate project that you create and authorise. Without one, the restore steps stay written down but untested.
