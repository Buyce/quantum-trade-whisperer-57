# Secure Admin Intelligence & Telemetry Terminal

Owner-only operations terminal at `/admin/intelligence`, restricted to boatengampomah@gmail.com, enforced in the database and again in the server function layer.

## Step 1 — Architectural audit (verified against the live database)

Current data volumes and index coverage were read directly from the database:

| Table | Rows | Relevant indexes today |
|---|---|---|
| `scanned_signals` | 62 | pk, `detected_at DESC`, `instrument`, 2 structure-key indexes |
| `shadow_executions` | 82 (79 resolved, 46 never-filled) | pk, unique `signal_id`, `detected_at DESC`, `(status, instrument, detected_at)`, partial open index |
| `executed_trades` | 12 | pk, unique `(user_id, signal_id)`, `(user_id, created_at DESC)` |
| `signal_user_telemetry` | **0** | pk, `(signal_id, event)`, unique `(user_id, signal_id, event)` |
| `regime_stats` | 35 | pk `(tier, regime_key)` |
| `scan_queue` | 2052 | pk, `(status, enqueued_at)` + partial pending |
| `profiles` | 5 | pk |

Findings:

- **No table-scan risk exists at this scale, and none will exist at the scale retention allows.** Tiered purging caps `scanned_signals` in the low hundreds; `scan_queue` is pruned to 7 days by `maintain_scan_queue()`. Every aggregate in this panel is a sequential scan over a few thousand tuples in shared buffers — single-digit milliseconds. The honest optimization is therefore *not* new indexes on the hot path; it is bounding the query windows (24h / 7d / last-200-signals) so cost stays constant as the app ages.
- **Only two indexes are actually justified**, both to keep the intersection feed and the discipline metric from scanning as telemetry grows: `signal_user_telemetry (event, signal_id)` — currently only `(signal_id, event)` exists, wrong leading column for "count by event" — and `executed_trades (signal_id, user_decision)`, which has no signal-leading index at all today (the existing unique index leads with `user_id`). Nothing else is added; speculative indexes would slow the writes on the live path we are protecting.
- **Read isolation.** The RPC is `STABLE`, does only `SELECT`s, and takes no explicit locks. Plain `SELECT` acquires `ACCESS SHARE`, which never conflicts with the `INSERT`/`UPDATE` the pipeline, `claim_scan_job()` and `claim_shadow_job()` issue. The workers use `FOR UPDATE SKIP LOCKED`, so an admin read cannot make a claim wait. To also remove any MVCC/planner interference the function runs with a short `statement_timeout` and `SET LOCAL` read-only semantics, so a pathological plan aborts itself rather than lingering.
- **`signal_user_telemetry` is empty.** Telemetry is wired (`feed.tsx` fires `recordSignalEvent` on decide) but no rows have landed yet, and no `viewed` event is emitted anywhere. Engagement panels will therefore read `executed_trades` (12 rows) as the primary decision source and telemetry as a secondary signal. Per the zero-hallucination rule, empty sections render explicit "no samples yet" states — never filled with examples.
- **State & real-time decoupling.** One RPC call = one payload for the whole panel. React Query with `staleTime` 60s, `refetchInterval` 60s, `refetchIntervalInBackground: false`, and `refetchOnWindowFocus: false`. A tab left open overnight therefore issues ~1 query/minute only while visible, and zero while hidden. No realtime subscription, no per-widget query.
- **Route & bundle isolation.** The panel lives at `src/routes/_authenticated/admin/intelligence.tsx`. TanStack Router file routes are code-split per route, so the chunk is only fetched when that path is visited; normal users never download it. The route's `beforeLoad` redirects non-owner emails to `/feed` before the component chunk is requested. Recharts is already in the bundle graph from the performance page, so no new heavy dependency is introduced.

## Step 2 — Core specification

Migration adds:

- Two composite indexes named above.
- `public.is_admin()` — `STABLE SECURITY DEFINER`, returns true only when `auth.jwt() ->> 'email'` equals the owner address (lower-cased compare). Executable by `authenticated`.
- `public.get_admin_intelligence()` — `STABLE SECURITY DEFINER`, `search_path = public`, first statement `IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'`. `REVOKE ALL ... FROM anon, authenticated` then `GRANT EXECUTE TO authenticated` (the guard inside is the gate) — so a standard user calling it directly gets an error, not data. Returns one `jsonb` document:
  - `engagement` — distinct accounts logging decisions, taken vs skipped totals per instrument, and aggregate EV / mean realized R of shadow executions attached to user-taken signals.
  - `learning` — per-regime rows from `regime_stats`: tier, key, N total, N filled, raw vs shrunk P(fill) and P(win), plus progress percentages toward the 150 / 200 activation gates and which gates have passed.
  - `intersection` — last 200 signals joined to decision counts (taken / skipped), shadow `resolved_outcome`, `realized_r`, `miss_distance_atr`, `trading_session`. Counts only, no user ids.
  - `health`, `webhooks`, `discipline`, `fill` — see Step 3.

Server layer: `src/lib/admin.functions.ts` exposes `getAdminIntelligence` with `requireSupabaseAuth`; the handler re-checks `context.claims.email` against the owner address and throws `Forbidden` before touching the database, then calls the RPC through `context.supabase` (so the JWT check in SQL is the same identity). No admin/service-role client is used for reads.

Route: `src/routes/_authenticated/admin/intelligence.tsx`, plus `admin/route.tsx` doing a client-side `beforeLoad` owner check with redirect to `/feed`. No loader (avoids SSR/prerender 401).

## Step 3 — Additional widgets proposed

1. **System health & cron heartbeat** — last scan cycle time, p50/p95 cycle duration derived from `scan_queue.started_at → finished_at` over 24h, pending/processing/failed counts, `shadow_engine_state.paused` + `consecutive_failures`, and per-instrument `instrument_health` availability with `unavailable_until`. This is the single highest-value widget: it answers "is the engine actually alive" without reading logs.
2. **Live fill-rate diagnostic** — rolling 24h and 7d fill vs never-filled rate bucketed by `trading_session`, with median `miss_distance_atr` for misses. This is the direct instrument for judging the new London/NY dynamic entry offset.
3. **Behavioural alpha / Discipline Index** — win rate of shadow outcomes on signals users *skipped* vs signals they *took*. Displayed with an explicit sample-size badge and suppressed below 20 decisions per side, because at 12 decisions today the number would be noise. Reading: skipped-win-rate > taken-win-rate means users are discarding the best setups.
4. **Webhook dispatch reliability** — **not implementable today**: `webhook.server.ts` only `console.error`s failures and persists nothing, so there is no data to aggregate. Proposal: add a `webhook_dispatch_log` table (signal_id, user_id, http status, latency_ms, error, created_at, 14-day prune) written fire-and-forget by the dispatcher, then surface success rate, p95 latency and last error. Flagged as a decision for you rather than silently faked.
5. **Grade → outcome calibration** — realized win rate and mean R per grade (A+/A/B/C) against the confidence score, to detect grade inflation. Cheap: same rows already fetched for the intersection feed.
6. **Signal freshness / dedup pressure** — signals suppressed by the `structure_key` cooldown in 24h, to see whether the dedup rule is starving the feed.

## Technical notes

- Everything is read-only aggregation; no change to `pipeline.server.ts`, the scan/shadow crons, grading, `regime_stats` recompute, or the user feed.
- All admin numbers are counts/aggregates over live rows; zero renders as zero with an empty-state message.
- Query windows are fixed (24h, 7d, last 200 signals) so cost does not grow with history.
- The owner email is a database-side constant in `is_admin()` and a server-side constant in the function module — not client-configurable.

## Open question

Widget 4 needs a new `webhook_dispatch_log` table plus a small write in the existing dispatcher. Say the word and I include it in this build; otherwise the panel ships with the webhook card omitted rather than blank.
