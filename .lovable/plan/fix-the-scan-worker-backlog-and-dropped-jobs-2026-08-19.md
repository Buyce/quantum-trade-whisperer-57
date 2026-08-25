# Fix the Scan Worker Backlog and Dropped Jobs

## What the data shows

Confirmed by direct queries just now:

- `scan_queue` has **57 jobs stuck in `pending`**, the oldest enqueued at **10:15 UTC** — a 4.5-hour backlog.
- The worker is alive (last job finished 14:45 UTC) but it is draining the _backlog_ in FIFO order, so it is grading candles for cycles that expired hours ago while the newest cycle waits behind them.
- Over the previous 24h, **69 jobs died with `Worker lease expired: job abandoned in processing`** — roughly 2-6 per hour, every hour, until 10:00 when the queue tipped into permanent backlog instead.
- The last published signal is from 13:45 UTC. Broker feed is healthy (all three instruments `available`), and the 11 MetaApi 504s are unrelated transient broker timeouts.

## Root cause

Each 15-minute cycle enqueues 3 jobs in one statement. The `scan_queue` insert trigger fires **one** worker kick per statement, and one worker pass drains at most 3 jobs _or_ 20 seconds of wall clock, whichever comes first. A single job can spend up to 3 x 8s on candle fetches, so any slow cycle exits with `budgetExhausted: true` and **nobody kicks the worker again** — there is no drain cron and no self re-kick. Leftovers sit in `pending` until the next cycle's kick, which then has even less budget. The backlog compounds; the lease-expiry failures are the same defect surfacing as abandoned in-flight jobs.

## The fix

1. **Self-chaining worker.** When a worker pass ends with jobs still pending (budget exhausted or `MAX_JOBS_PER_REQUEST` hit), it fires one non-blocking follow-up request to itself with the cron secret. Guard with a hop counter in the request body (hard cap, e.g. 8 hops) so a permanently failing queue cannot loop forever.

2. **Safety-net drain cron.** A `pg_cron` entry every 2 minutes calling `/api/public/worker/process`, so the queue always drains even if a kick is lost — the same pattern already used for the shadow worker. This is the single most important change: it makes queue progress independent of trigger delivery.

3. **Staleness guard.** A claimed job whose `enqueued_at` is older than one scan interval (15 minutes) is closed as `result = 'stale'` without fetching candles. Grading 4-hour-old queue entries against live candles produces duplicate or misleading setups and burns the whole time budget. This is the mechanism that clears the current 57-job backlog on the next pass.

4. **One-off backlog clear.** Mark the existing 57 pending rows older than 15 minutes as `stale` in the same migration, so the queue starts clean rather than replaying half a day.

5. **Lease reclaim, tightened.** `maintain_scan_queue()` already reclaims leases after 5 minutes but marks them `failed` permanently. Change it to retry once (`pending`, `attempts + 1`) and only mark `failed` at `attempts >= 3`, matching `maintain_shadow_queue()`. That converts most of the 69 daily "abandoned" jobs into completed work.

6. **Admin visibility.** Add a queue-backlog line to the Admin Intelligence Terminal: oldest pending age and pending count, tinted red past 15 minutes, plus a `stale` bucket in the 24h results card. A four-hour stall was invisible on the current panel — that is worth fixing alongside the cause.

## Technical notes

- Files: `src/routes/api/public/worker/process.ts` (self-chain + hop cap), `src/lib/scanner/pipeline.server.ts` (staleness guard in `processNextJob`), one migration (drain cron, `maintain_scan_queue()` retry semantics, backlog clear), `public.get_admin_intelligence()` (backlog fields), `src/components/admin/AdminPanels.tsx` + `src/routes/_authenticated/admin/intelligence.tsx` (display).
- No change to grading, profile building, dedup cooldown, the shadow engine, alert fan-out, or any user-facing feed query.
- Zero synthetic rows: the backlog clear only closes queue jobs, it never writes to `scanned_signals`, `market_context`, or `executed_trades`.
- After deploy: verify pending count returns to 0 within one cycle and that a fresh cycle publishes with `detected_at` inside the current 15-minute window.

## Deferred

The unreachable A / A+ grade tier (no A-grade signal has ever been published; max `pillars_passed` is 3) stays untouched in this change. Worth revisiting once the queue drains reliably, since a starved queue may itself be suppressing A-tier candidates.
