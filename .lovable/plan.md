# Promotion checkpoint is under-counting the evidence

Short answer: the scanner and the spread sampler are working. The checkpoint panel is
reading only a small slice of the collected data, so it reports a fraction of the samples
that actually exist and will never reach the 200 mark on its own.

## What the data actually shows (last 14 days)

| Instrument | Valid samples | Days | Sessions | Panel showed |
| --- | --- | --- | --- | --- |
| GBPUSD | 472 | 13 | 5/5 | 80 valid, 3 days |
| USDJPY | 784 | 13 | 5/5 | ~120, 3 days |
| USDCHF | 755 | 13 | 5/5 | — |
| AUDUSD | 718 | 13 | 5/5 | — |
| USDCAD | 558 | 13 | 5/5 | — |
| EURUSD | 514 | 14 | 5/5 | 82 valid |

6,713 samples were recorded in the window, on every day since 27 August, for all eight
instruments, most recently 04:05 today. Collection is healthy.

## Root cause

The checkpoint asks the database for the newest 20,000 sample rows, but the data API caps
any single read at 1,000 rows. It therefore receives only the newest ~1,000 samples — about
the last three days across all eight instruments — and counts days, samples, sessions and
provider symbols from that slice. That is exactly why every instrument reads "3 day(s)" and
roughly one-eighth of 1,000 valid samples. The 5-day and 200-sample gate is unreachable by
construction, no matter how long sampling runs.

Two smaller defects found alongside it:

- **Missingness units and row choice.** The stored statistics are fractions per session
  bucket (0.0833, 0.875, ...). The checkpoint takes whichever bucket row happens to come
  back first and prints it as a percentage, so it can show "0.1%" for a bucket that is
  really 8.3% missing, or pick an unrepresentative bucket. It is currently too lenient.
- **Readiness flapping.** Conversion route/data checks alternate day to day
  (XAUUSD and GBPAUD failed both legs today; EURUSD, USDCAD failed the live data leg;
  USDCHF failed the route leg while its data leg passed). This is a separate transient-quote
  problem, not a sampling problem, and it must be diagnosed from the stored proofs rather
  than retried away.

## Fix

1. Move the counting into the database instead of pulling raw rows into the app: one
   owner-only aggregate that returns, per instrument, distinct valid trading days, valid and
   rejected sample counts, covered sessions, distinct observed provider symbols and a true
   overall missingness percentage over the same window. The pure gate module keeps its
   thresholds and fail-closed behaviour unchanged and simply receives correct numbers.
2. Compute missingness as one window-wide percentage of attempts with no usable tick,
   derived from the samples themselves, so units and coverage are unambiguous.
3. Keep every absent value `null`, which the gate already treats as a blocker — no
   defaulting, no estimating.
4. Read the stored conversion proofs for XAUUSD, GBPAUD, EURUSD, USDCAD and USDCHF and
   report which leg failed and why, before proposing any readiness change. Report, not patch.

Expected outcome once counting is correct: GBPUSD and USDJPY meet days, samples and session
coverage today and their latest readiness snapshots pass, so they should read **promotable**.
USDCHF, AUDUSD, USDCAD and EURUSD meet the sample evidence but stay blocked on the
conversion-leg readiness until that is resolved. XAUUSD, GBPAUD and EURUSD remain outside this
checkpoint's scope where already execution-approved.

## Technical detail

- New security-definer aggregate (owner/service-role only) reading
  `instrument_spread_samples`, plus the existing latest-snapshot and lifecycle reads.
- `src/lib/instruments/promotion.server.ts` switches from a 20,000-row `select` to that
  aggregate; drops the first-row `instrument_spread_stats` missingness pick.
- `src/lib/instruments/promotion.ts` unchanged (thresholds, blockers, fail-closed semantics).
- New tests: aggregate-shaped evidence produces the expected verdicts; a truncated/partial
  read must never silently under-count (missing aggregate ⇒ blocked, not "0 samples").
- `docs/INSTRUMENT-LIFECYCLE.md` notes that checkpoint counts are database-side aggregates.
- No change to grading, sizing, lifecycle stages or execution. Live execution stays off.
