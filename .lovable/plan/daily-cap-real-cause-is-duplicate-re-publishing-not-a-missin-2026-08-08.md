# Daily cap: real cause is duplicate re-publishing, not a missing midnight reset

## What the audit found

Your finding is half right: the counter does reset, but the cap still fills up every night, so the effect you see is real.

- The scanner's quota query counts only signals with `detected_at` on or after today's UTC midnight, so it does roll over at 00:00 UTC. Confirmed in the data: 30 capped setups on Aug 7 and a fresh 30 on Aug 8.
- The real problem: the scanner re-publishes the **same setup** on every 15-minute cycle. Today's 30 rows are XAUUSD long @ 4343.88 and GBPAUD short @ 1.90883 repeated every 15 minutes from 00:00 to ~03:45 UTC. The quota was exhausted less than four hours after midnight by duplicates of two setups, which then blocks all further alerts for the rest of the day.
- Secondary issue: the feed's "Setups today" counter uses **browser local** midnight while the scanner uses **UTC** midnight. On Amsterdam time the on-screen number starts counting from 22:00 UTC the previous evening, so it can disagree with the scanner's own quota.
- No signal ever leaves `active`: every row in the table is still `status = 'active'`, `resolved_outcome = 'open'`, which is why the feed accumulates identical cards.

## The fix

### 1. Stop duplicate publishing (root cause)

Before inserting, the pipeline checks for an existing **active** signal on the same instrument, same direction, whose entry price is within a small fraction of ATR of the new one (same structural setup). If one exists, the job finishes as a new `duplicate` result — nothing is inserted, no alert fires, no quota is consumed. A genuinely new structure (different direction, or entry moved beyond the tolerance) publishes as normal.

A database guard backs this up so a race between two workers cannot slip a second copy through: a partial unique index on active signals per instrument + direction + rounded entry price, with the insert tolerating a conflict as a duplicate rather than crashing the job.

### 2. Age out stale setups

A setup that is still `active` after a set lifetime (24 hours) no longer reflects live structure. The scan cycle marks those rows `status = 'expired'` at the start of each run. This keeps the feed honest, lets a fresh version of the same setup publish the next day, and does not touch resolved trades or user-logged decisions.

### 3. Align the on-screen counter with the scanner

The feed's "Setups today" counter switches to UTC midnight and to the same capped-grade set the scanner uses, so 12/30 on screen means exactly 12 against the scanner's quota.

## Technical notes

- Files: `src/lib/scanner/pipeline.server.ts` (duplicate guard, expiry sweep, new `duplicate` job result), `src/routes/_authenticated/feed.tsx` (UTC counter), plus one migration for the partial unique index on `scanned_signals`.
- Untouched: grading (`grading.ts`, `profile.ts`, `indicators.ts`), MetaApi fetching and timeouts, queue mechanics and `claim_scan_job`, alert fan-out rules and `alert_min_grade`, cap value (30) and the C-Grade bypass, performance KPIs.
- Zero-Hallucination rule respected: no seeds, no synthetic rows, empty states unchanged. Expiry only changes `status` on rows the live scanner itself wrote.
- No existing rows are deleted. Today's duplicate backlog will age out through the 24-hour expiry sweep; say the word if you want it cleared immediately instead.

Also increase the dayli cup to 50
