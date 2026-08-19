# Weekly Shadow Report + Live Market Status

Two independent additions: an automated weekly A/A+ vs B/C performance email, and a market-session status strip on the feed page.

## Part 1 — Weekly shadow performance report

A cron-triggered job that reads resolved `shadow_executions` rows, splits them into a high tier (A, A+) and a low tier (B, C), compares them, and emails the result to the owner every Monday.

What the report contains, per tier:

- sample sizes: enrolled, filled, resolved
- fill rate, win rate (of filled), mean realized R, total R, expectancy in R
- median `miss_distance_atr` for non-filled setups
- statistical significance of the high-vs-low win-rate and fill-rate difference: two-proportion z-test with the z score, two-sided p-value, and a plain-language verdict (significant / not significant / not enough data)
- an explicit "insufficient samples" verdict per comparison when either tier has fewer than 30 resolved rows — no invented rows, no padded numbers, zero stays zero

Delivery: `boatengampomah@gmail.com`, Mondays 08:00 UTC, via the existing transactional email pipeline with an idempotency key derived from the ISO week so a retry cannot duplicate the mail. If a week has zero resolved rows, the email still sends and says so.

The same numbers are also exposed to the admin intelligence page so the owner can read the current week without waiting for Monday.

## Part 2 — Market open/closed on the feed

A compact status strip under the existing scan heartbeat showing the four FX sessions (Sydney, Tokyo, London, New York) with a live open/closed dot, using the same UTC session boundaries the scanner already uses, plus the current active session highlighted and minutes until the next session change.

It also reflects the weekend close: from Friday 21:00 UTC to Sunday 21:00 UTC the strip shows "Market closed — weekend", and per-instrument rows show as unavailable when `instrument_health` says the broker feed is down. Purely presentational — it reads existing data and derives session state from the clock; it does not change scanning, grading, or filtering.

## Technical notes

- New `src/lib/reports/weekly.server.ts` — pure aggregation + `twoProportionZTest` maths over live rows only; no fallbacks.
- New `src/lib/reports/weekly.functions.ts` — owner-only server fn (same email gate as `admin.functions.ts`) so the admin page can render the current snapshot.
- New email template `src/lib/email-templates/weekly-shadow-report.tsx`, registered in `registry.ts`.
- New route `src/routes/api/public/cron/weekly-report.ts`, gated by `authorizeCronRequest`, mirroring `cron/shadow-resolve.ts`.
- Migration: `pg_cron` job `weekly-shadow-report` at `0 8 * * 1` posting to that route with the existing `apikey`/`x-cron-secret` header pattern; plus a small latch table/row so a re-run in the same ISO week is a no-op.
- New `src/lib/market-hours.ts` (pure, testable) + `src/components/MarketStatus.tsx`, rendered in `src/routes/_authenticated/feed.tsx` next to `ScanHeartbeat`. Session boundaries copied from `sessionOf` in `pipeline.server.ts` to keep one definition of truth.
