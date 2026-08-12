# P-Trades Hub — Full System Audit & Master Report

Audit is complete (code + live database). No files were changed: this session is in plan mode, so every fix below is queued for your approval rather than applied. Nothing in this plan touches the Zero-Hallucination rule — no seeds, mocks, or placeholder rows anywhere.

## Part 1 — The Bug Ledger (confirmed, with root cause)

Ordered by severity. Each item was verified against the code and, where relevant, against live data.

1. **`volatility_index` is mathematically meaningless on every published signal.** `src/lib/scanner/pipeline.server.ts:227` computes `h1Atr` as `Math.abs(last H1 close)` — a raw price (e.g. 4343.88 for XAUUSD), not an ATR. It then divides M15 ATR by that price at line 275. Every `market_context` row written since launch has a corrupted volatility figure. Fix: use `atr(candles.H1, 14)` from `indicators.ts`.
2. **Orphaned "ghost" signals.** If the `market_context` insert (`pipeline.server.ts:272`) fails after the signal insert succeeded, the throw is caught at line 300 and the job is marked `failed` — but the signal row stays `active` and visible in the feed with no context, and the alert has not been sent. Fix: on context failure, delete the just-inserted signal (compensating rollback) before failing the job, or move the context insert before alerts and treat its failure as non-fatal with a repair pass. Live check: 0 orphans today, so this is latent, not active damage.
3. **A successful publish can be reported as `failed` because of email.** `sendSignalAlerts` is awaited unguarded at `pipeline.server.ts:283` after both rows are committed. Any throw from it (network-level fetch failure on the settings query) marks the job failed and flags the instrument unavailable even though the signal is live. Fix: wrap the alert call in its own try/catch and log-only.
4. **Failed jobs are never retried; a 504 silently costs a whole 15-minute cycle.** Live data: **105 failed jobs** in `scan_queue`, nearly all `MetaApi 504 for … H4`, all with `attempts = 1`. `claim_scan_job` only ever claims `status = 'pending'`, so a failure is terminal. Fix: on transient failure (504/timeout), return the job to `pending` while `attempts < 3`, otherwise fail it.
5. **Jobs stuck in `processing` are wedged forever.** `claim_scan_job` has no lease/reclaim, and nothing in the codebase sweeps stale `processing` rows. Live data: 1 row stuck since Aug 6. Any function timeout mid-job (worst case ~72s per request: 3 jobs × 3 timeframes × 8s) leaves a permanent zombie row. Fix: reclaim rows whose `started_at` is older than 5 minutes back to `pending`.
6. **Duplicate-key failures are recorded as hard failures.** Two live jobs failed with `[23505] scanned_signals_active_unique` — a benign duplicate that the code already knows how to handle in `processNextJob`, but the constraint fires on the *insert path* in cases the pre-check missed and is only mapped to "duplicate" for that one code path. Fix: normalise every 23505 to `duplicate`, never `failed`.
7. **`scan_queue` grows forever.** 1,968 rows and climbing (~288/day). It is pure telemetry with no retention. Fix: prune rows older than 7 days in the existing hourly cron.
8. **Dead columns / inconsistent job bookkeeping.** `finish()` writes `processed_at` but never `finished_at`, so the schema carries two half-populated completion timestamps. Fix: write one, drop reliance on the other.
9. **Unhandled promise rejections (silent console errors).**
   - `src/routes/index.tsx:62` — `supabase.auth.getUser().then(...)` with no `.catch`.
   - `src/routes/_authenticated/settings.tsx:329` — clipboard write is un-caught and still toasts "Copied" on failure.
   - `src/routes/_authenticated/settings.tsx:285` — `Notification.requestPermission()` un-caught.
   - `src/components/AppShell.tsx:24` — `signOut()` can reject, leaving the user stuck with no feedback.
10. **Wrong-number-with-a-straight-face in the UI.** `SignalCard.tsx:181-200` falls back from pillar scores to confluence scores (`p_order_block ?? c_symmetry`, `p_momentum ?? c_rr`) — different metrics on the same axis. Fix: render "—" when a pillar is null instead of substituting an unrelated metric.
11. **Missing error feedback.** `/performance` and `/settings` never check `isError` on their queries, so a failed fetch renders as an empty terminal rather than an error. There is also no per-route `errorComponent` under `_authenticated`, so one render crash blanks the whole shell.
12. **Realtime resubscribe churn on the feed.** `feed.tsx:64-89` keys the Supabase channel effect on `alertMinGrade`, so the channel is torn down and rebuilt whenever settings load or change — with a window where INSERTs are missed. Fix: hold the threshold in a ref, depend only on `queryClient`.

## Part 2 — Performance Report (where time and data leak)

**Scanner (per job, up to 9 round-trips):**
- `isDuplicateSetup` pulls up to 200 rows over the wire to compare in JS, while the DB unique index already guarantees correctness. Replace with an indexed equality filter, or delete the pre-check and rely on the 23505 path.
- `countToday` runs once per instrument instead of once per cycle. Live data shows **327 `capped` outcomes** — the cap is doing a lot of work, so this query is hot.
- `clearInstrument` upserts `instrument_health` on every success even when nothing was flagged.
- `sendSignalAlerts` calls `auth.admin.getUserById` once per recipient (N+1).
- Sequential 3×8s candle fetches per job; the worker chains 3 jobs per request with a job-count bound but no wall-clock budget. This is the most likely real-world trigger for bugs 2 and 5. Proposal: add a ~20s elapsed-time budget and stop chaining early.

**Frontend:**
- `signalsQuery` fetches 400 wide rows (with a joined relation) and filters entirely client-side; both `/feed` and `/performance` mount it.
- `myTradesQuery` and `takenTradeHistoryQuery` have **no `.limit()` at all** — unbounded and growing forever.
- All table/query results are cast through `as never` / `as unknown as`, so schema drift fails at runtime instead of build time.
- Duplicated logic worth consolidating: `price()` (SignalCard + history), `signalOf()` (history + export), two grade-rank maps (`GRADE_RANK` vs `GRADE_ORDER`), three near-identical metric-card components, and the same `try/await/invalidate/toast/finally` block in four places.

## Part 3 — UX / Market Proposal (not to be implemented yet)

Benchmarked against TradingView and algo-desk dashboards, the terminal's problem is not looks — it is that everything shouts at once.

- **Feed:** above the first card sit an onboarding banner, title, cap counter, two switches, Refresh, Export, a filter-chip row, and a possible warning bar. Two overlapping grade gates ("My settings filter" vs Settings `min_grade`) make it unclear why a setup is hidden. Proposal: one compact control bar with a single "Filters" popover, filter state summarised as a single chip, and the cap counter demoted to a thin progress line.
- **Signal card:** collapse to a scannable summary row (instrument, grade, direction, R:R, confidence, age) with details expanding on click. Grade colour should carry the hierarchy so the eye lands on A+ first.
- **Performance:** KPI strip, chart, heatmap and two tables render unconditionally, so a new user sees mostly empty grids that read as broken. Proposal: progressive disclosure — KPIs and expectancy first, chart/heatmap behind tabs, and honest "needs N more samples" states instead of empty grids.
- **History:** every row carries a permanently open outcome editor. Proposal: expand-to-edit.
- **Settings:** seven unrelated concerns in one scroll. Proposal: tabs — Filters & Alerts / Notifications / Diagnostics / Account. The DNS/sender-domain table is an ops panel and should move behind Diagnostics or off the user-facing page entirely.
- **Mobile:** the data-dense grids need a defined single-column collapse per card; worth a dedicated pass.

## Suggested execution order (on approval)

1. **Batch A — correctness (small, low risk):** bugs 1, 2, 3, 6, 9, 10, 11, 12.
2. **Batch B — pipeline resilience (one migration + pipeline edits):** bugs 4, 5, 7, 8 plus the wall-clock budget.
3. **Batch C — query hygiene:** row limits, indexed duplicate check, per-cycle cap count, alert batching, shared helpers.
4. **Batch D — UX overhaul:** only the items you approve from Part 3.

## Questions before we proceed

1. Should I apply Batch A + B immediately (they are bug fixes with no UX change), and keep Batch C/D for separate approval?
2. Retry policy on MetaApi 504s: retry the same instrument up to 3 times within the same cycle, or defer it to the next 15-minute cycle?
3. `volatility_index` is currently corrupt on all historical rows. Recompute is impossible without re-fetching candles — do you want the bad historical values left as-is, or nulled so charts don't trust them?
4. Which of the UX items above are in scope for you: the feed control bar, the collapsible signal card, the Performance tabs, or the Settings tabs?
