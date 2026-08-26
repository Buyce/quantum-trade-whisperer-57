# Wave 1 Promotion Checkpoint + Readiness Defect Repair

Two pieces of work, both evidence-only. Nothing here promotes an instrument, changes
grading, sizing or lifecycle stages, or touches live execution (still globally off).

## Part 1 — Repair the two readiness defects

What the latest snapshots (26 Aug 03:10) actually show:

- **GBPUSD** — mapping, specification, H4/H1/M15 series and conversion all passed.
  The single failing check is the quote: "the quote had a zero or inverted spread".
  One malformed broker tick during a thin hour failed the whole run — the same tick
  class already seen on EURUSD. This is transient, not structural.
- **USDCHF** — `ready` is true and every conversion route quoted live in the route
  check, yet the independent live conversion proof recorded a missing leg, so
  `conversion_data_ready` came back false. That points at one failed/timed-out leg
  quote inside the proof step rather than a real missing route. To be confirmed by
  re-reading the stored proof before any code change.

Fix approach:

1. Confirm the USDCHF cause from the stored `conversion_live` proof (which leg, what
   reason). If it is a broken route rather than a failed fetch, stop and report — do
   not paper over it.
2. Make the quote check tolerant of a single bad tick without becoming permissive:
   on a zero/inverted/stale tick, re-quote a small bounded number of times with a
   short delay, and fail only when every attempt is malformed. The failure detail
   records how many attempts were made, so a genuine broker problem still fails.
3. Apply the same bounded retry to each conversion-proof leg fetch, so one timeout
   cannot mark an instrument's conversion data unusable.
4. Distinguish "malformed tick" from "no quote at all" in the recorded reason, so a
   promotion decision can see which happened.
5. Re-run readiness for GBPUSD and USDCHF and read the new snapshots. If they still
   fail, the cause is structural and gets reported rather than retried away.

Fail-closed behaviour is preserved: an instrument whose evidence cannot be obtained
stays not-ready.

## Part 2 — The promotion checkpoint

Today's evidence: spread/ATR sampling is live for all eight instruments (Wave 1 since
25 Aug 17:30, latest sample 10:30 today), but the aggregates hold **1 distinct trading
day**. Nothing is promotable yet. The checkpoint makes that judgement explicit and
repeatable instead of a manual eyeball.

Evidence gate for `data_validation` -> `shadow`, per instrument:

- at least 5 distinct trading days of valid spread samples
- samples present in every session the instrument is scanned in
- sample missingness at or below an agreed ceiling
- the most recent readiness snapshot ready, with route and live conversion data both
  ready, and no readiness failure in the trailing window
- provider symbol mapping verified and unchanged across the window
- a usable spread floor candidate derived from real samples

All thresholds live in one pure module with tests, so the rule is inspectable and
cannot drift between the panel and any later action.

Admin surface: a new collapsible "Promotion checkpoint" panel in Admin Intelligence
listing each Wave 1 instrument as **promotable** or **blocked**, with every unmet
criterion named and the actual measured value beside it (days covered, sessions,
missingness, last readiness result). Wave 2 stays out of scope and is shown as
disabled/not sampled.

The panel is read-only reporting. Promotion itself remains the existing approved,
audited `transition_instrument_stage` action taken by you, one instrument at a time,
with the checkpoint output as its recorded evidence.

## Technical detail

- Pure gate module under `src/lib/instruments/` (thresholds + verdict shape), with
  unit tests including the fail-closed cases (no rows, unreadable stage, stale
  readiness).
- Server function reading `instrument_spread_stats`, `instrument_spread_samples`,
  `instrument_readiness_snapshots` and `instrument_lifecycle`; admin-scoped.
- Bounded quote/leg retry inside `readiness.server.ts` and
  `readiness-snapshot.server.ts`; no change to the readiness code hash semantics
  beyond the new attempt detail.
- No migration is required unless confirming USDCHF reveals a stored-shape gap.
- Docs: `docs/INSTRUMENT-LIFECYCLE.md` gains the promotion gate; `docs/OPERATIONS.md`
  gains the checkpoint runbook.

## Expected end state

Wave 0 unchanged and execution-approved. Wave 1 still `data_validation`, but with
GBPUSD and USDCHF readiness clean and a panel that states, per instrument, exactly
what is still missing and when the evidence window closes (earliest realistic review
around 1 Sep). Wave 2 disabled. Live execution disabled.
