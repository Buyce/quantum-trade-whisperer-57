# Step 5 — Smarter exits, tested in replay only

This is the last unfinished item in the improvement programme. Steps 1–4
(loss brakes, execution-quality scoring and cool-downs, adaptive spread norms,
walk-forward validation) are built and running.

## What is missing today

The replay engine resolves each setup to a single exit at the first target and
stores summary numbers only: best excursion, worst excursion, which target the
path touched, and flags marking the cases where a 15-minute bar cannot say which
event came first. Those summaries cannot answer "would a partial exit plus a
runner have done better", because two numbers do not record the order of events.
That is exactly why partial exits, break-even moves and trailing stops currently
report "not decidable" rather than a result.

## What this step does

1. **Record the ordered path after entry.** For each replayed setup, store a
   compact, bounded per-bar record of what price did after the fill (bar time,
   high/low expressed in R, and the existing ambiguity flag for that bar). Bars
   are capped per setup so storage and compute stay bounded. Written by the same
   hourly replay resolution job that already runs — no new job, no second source
   of candles, and no change to the outcome the platform uses today.

2. **Simulate exit variants off that stored path.** A pure, testable evaluator
   replays each variant against the recorded path:
   - single exit at first target (today's policy, the baseline),
   - partial at first target with the rest running to the second/third,
   - move to break-even after a set advance,
   - trailing stop variants.
   Any bar whose internal order is unknowable makes that setup **undecidable for
   that variant** and it is excluded from that variant's sample — never resolved
   in the platform's favour.

3. **Judge variants out-of-sample.** Results go through the walk-forward
   evaluator built in Step 4: a variant is only reported as better when it wins
   on a later, unseen period with enough independent trading days behind it.

4. **Show it as research.** One panel in Admin → Intelligence lists each variant
   with its average R, sample size, how many setups were undecidable, and whether
   the out-of-sample check confirms it. Clearly labelled research, replay-derived.

5. **Live policy does not change.** Real execution stays single exit at the first
   target until a variant beats it out-of-sample, and switching would be a
   separate, deliberate decision by you.

## How this avoids double work and orphaned data

- The path is captured inside the existing replay resolution pass, from the
  candles it already fetches. Nothing is fetched or sampled twice.
- No new scheduled job and no new candle store: one new table for the path,
  written once per setup and never rewritten.
- Producer, consumer and panel ship together, so nothing is collected without
  something reading it — the failure mode that made Step 1 need a follow-up.
- Existing replay outcomes, versions and provenance are untouched; the new data
  sits beside them under the same replay version and policy labels.
- Nothing is invented: missing candles mean unresolved, ambiguous bars mean
  undecidable, thin samples mean "not measured".

## Technical notes

- New table `replay_path_bars` (or a bounded JSONB column on
  `shadow_executions`, chosen for row-count safety), owner-invisible /
  service-role plus admin read, with grants and RLS.
- Path capture added to `src/lib/execution/replay-v2.ts` and persisted in
  `shadow_resolve.server.ts`; existing `ReplayV2State` fields keep their meaning.
- New pure evaluator `src/lib/execution/exit-variants.ts` plus unit tests
  covering each variant, undecidable bars, invalid plans and thin samples.
- Out-of-sample judgement reuses `src/lib/stats/walk-forward.ts` and the
  instrument-day cluster statistics already in place.
- Admin surface: new server function beside `getAdminWalkForward`, rendered by a
  new panel next to `WalkForwardPanel`.
- Bars per setup capped (proposed 400 M15 bars, ~4 days) and rows per pass
  bounded, consistent with the existing worker budgets.
