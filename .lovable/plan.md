# Fix the shadow replay "DEGRADED" state — MetaApi rate-limit handling

## What the screen is telling you

Nothing is broken in the app itself. Both messages on the card come from the
same upstream cause: the broker data provider (MetaApi) refused or stalled the
candle requests.

- Scan engine: RECOVERED — 43/44 jobs OK, last cycle fine. It already
  self-healed.
- Shadow replay engine: DEGRADED — its last run 51m ago failed once, and the
  reason is `market-data fetch failed at the provider`.
- The two quoted provider errors are the actual cause:
  - `ToManyRequestsError` (HTTP 429): "maximum of 5 concurrent historical
    market data requests per account".
  - `MetaApi request for EURUSD/XAUUSD/GBPAUD M15 exceeded 8000ms and was
    aborted` — requests queued behind the provider's limit until our own
    8-second timeout aborted them.

So this is a provider throughput/quota problem, not missing data and not a bug
in grading, execution or the panels.

## Why it is happening now (confirmed in code)

- `REQUEST_TIMEOUT_MS` is 8s and every MetaApi call gets aborted at that point.
- The retry logic in `src/lib/metaapi/request.server.ts` retries only 502/503/504
  for GETs. **429 is classified as `rate_limited` but never retried, and the
  `retry-after` header we already parse is never honoured.** A rate-limited
  candle fetch therefore fails the whole run immediately.
- There is no shared concurrency limiter across jobs. The 15-minute scan cycle,
  the hourly shadow-resolve pass (production + Replay-V2 + research-candidate
  budgets, up to 200 + 60 + N rows) and the spec/quote refresh crons all issue
  candle fetches against the same broker account, so together they can exceed
  the provider's 5-concurrent cap.
- Because the shadow engine only needs one failed run to report DEGRADED, a
  single rate-limited pass paints the whole panel yellow even though the next
  pass usually succeeds.

## Proposed fix

1. **Honour rate limits instead of failing.** Treat 429 as retryable for GET
   reads: back off using the provider's `retry-after` (falling back to a short
   exponential delay), bounded to a couple of attempts so a cycle can never
   overrun. No mutation is ever retried — that invariant stays.

2. **Serialise market-data reads.** Add one shared, server-side concurrency gate
   (max 4, i.e. below the provider's 5) that every historical-candle request
   passes through, so the scanner, the replay passes and the crons queue behind
   each other instead of colliding.

3. **Stagger the jobs.** Move the shadow-resolve/candidate replay pass off the
   minutes where the scan cycle fetches candles, so the two heaviest candle
   consumers do not overlap by schedule.

4. **Report it accurately.** In the engine-status card, distinguish
   "rate-limited by the provider" from a generic fetch failure, and require more
   than one consecutive failure before the shadow engine reads DEGRADED — one
   throttled pass is normal and self-correcting.

## What stays untouched

- No change to grading, eligibility, sizing, enqueue or execution logic.
- No data written, seeded or synthesised. Failed cycles keep meaning "missing
  data, not absence of setups" exactly as the card already says.
- Fail-closed behaviour preserved: if candles still cannot be fetched after
  backoff, the run reports the failure rather than guessing.

## Technical notes

- Files in scope: `src/lib/metaapi/request.server.ts` (429 retry + retry-after),
  a new small gate module used by `src/lib/metaapi/market.server.ts`,
  cron schedule for the shadow/candidate pass, and
  `src/lib/engine-status.ts` + `EngineStatusPanel` for the reporting change.
- Tests: unit coverage for 429-with-retry-after backoff, the concurrency gate
  capping parallel reads, and the revised degraded-threshold logic.
