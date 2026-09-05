# Audit: learning, statistics, data collection and decision-making

## The honest answer to your four questions

**Are we succeeding?** The terminal and app work, and the machinery is all
built. But the *learning* half is not yet earning its keep: today it collects
plenty and concludes almost nothing, because three data streams are empty or
stalled and two measurement standards disagree with each other.

**What is actually live right now** (verified in the database today):

| Stream | State |
|---|---|
| Published setups replayed against real candles | Working — 1,097 resolved |
| Per-instrument payoff statistics | Working — 14 slices, all labelled "descriptive" |
| Regime statistics | Working — 94 rows |
| Spread norms | Working — 342 measured slices |
| Execution quality | Working — 33 slices, all still "not measured" (too few closes) |
| Research (rejected-setup) cohort | **Enrolled 628, resolved 0** |
| Filter-lift evidence | Runs cleanly now, but every arm reads 0 resolved |
| Corrected replay (V2) + post-entry paths | **0 rows, 0 paths** |
| Exit-variant study | Runs hourly, 0 samples — waiting on those paths |
| Walk-forward confirmations | **0 recorded** |
| Gate proposals / overrides | **0** — so no threshold has ever moved |
| Drawdown brake state | **0 rows** — brakes hold nothing |

So: data collection is broad, but the chain that turns it into a decision is
open in four places.

## Conflicts found — the real ones

### 1. Two different bars for "enough evidence", and the looser one is the only one wired to a live decision
There is a module that documents itself as *the* single sufficiency gate
(30 observations, 10 independent trading days, predeclared, holdout-confirmed).
Almost nothing calls it. Five other places define their own floor instead —
10 days here, 5 days there, 200 samples somewhere else, and one path with no
day requirement at all. Meanwhile the one statistic that can *refuse a live
order* and *reorder the daily cap* uses the loosest bar of all: 30 samples, no
predeclaration, no holdout.

### 2. The live cohort read is the only one not scoped to a replay version
Every other reader of the replay table pins cohort, replay version and
execution policy. The live cohort read pins none of them — it only asks for
"resolved". Today that is harmless by luck: every resolved row happens to be
production/V1. The moment research setups or corrected-replay rows start
resolving (which is exactly what the next steps do), rejected-cohort and
corrected-policy outcomes will silently pool into the number that blocks live
orders.

### 3. "Expected R" is computed three different ways
One module is the documented authority on it and correctly separates
per-plan expectancy from conditional expectancy. Two others re-derive it
independently, and the live one silently drops never-filled and gapped setups
instead of scoring them at zero — which flatters expectancy on exactly the
population used to refuse orders.

### 4. Three confidence-interval regimes coexist
Day-clustered bootstrap (the declared primary), a plain normal approximation
used by filter-lift and the learning evidence surface, and a Wilson interval
implementation with no callers at all. Same question, three answers of
different widths.

### 5. Built but inert
Wilson intervals and the multiple-comparison correction are fully written and
never called. The counterfactual study runs only when an admin opens a panel.
Corrected replay is switched on but has produced nothing yet — new setups only
appear after weekend quiet hours end, so this one will resolve itself.

## Why nothing has resolved on the research side
450 in-window research rows are being visited every hour, get their timestamp
touched, and advance zero bars — they are starved of candles, not stuck in
code. The out-of-window rows are already correctly excluded. The remaining
cause is the candle supply for the research backfill, not the resolver loop.

## Plan

### Step 1 — Make one sufficiency standard binding
Route every verdict (filter lift, readiness, cohort judgement, exit variants,
walk-forward) through the single evidence gate instead of local constants.
Where a surface genuinely needs a different bar, it must declare it as a named
tier of that gate rather than its own number. No bar is loosened.

### Step 2 — Scope the live cohort read
Pin the live cohort read to production cohort, V1 replay and the legacy policy,
matching every sibling read. This closes the contamination path before the
research and V2 streams start producing rows.

### Step 3 — One definition of expected R
Make the live cohort read use the documented per-plan estimand — never-filled
and gapped setups counted at zero, invalid plans excluded — so the number that
refuses an order means the same thing as the number shown in Admin.

### Step 4 — One interval method
Move filter-lift and the learning evidence surface onto the day-clustered
bootstrap. Either wire the Wilson/multiplicity code into the surfaces that
need it, or delete it — no dormant statistical code that implies a guarantee
it does not provide.

### Step 5 — Unstarve research resolution
Diagnose the candle supply for the 450 in-window research rows (fetch budget,
instrument set, weekend window) and raise exactly what is short, so filter
lift, walk-forward and the gate ledger finally receive input. No fabricated or
back-dated outcomes.

### Step 6 — Confirm the chain end to end
After a clean hourly run: research rows resolving, filter lift with non-zero
resolved counts, at least one walk-forward record written, corrected-replay
rows with recorded paths, and the brake state populating for your accounts.
Report the numbers rather than declaring success.

## Rules kept
No seeded, mocked or fallback trading data. Unmeasured stays unmeasured.
Live exit policy stays single-exit-at-first-target. Every gate reduce-only.
Live execution stays off (verified off today).

## Technical notes
- Single gate: `src/lib/stats/evidence.ts`; competing floors in
  `stats/walk-forward.ts:24`, `learning/filter-lift.ts:17`,
  `learning/readiness.ts:19`, `learning/regime.ts:15`,
  `learning/exit-variants.server.ts:40`, `learning/cohort.ts:112`.
- Unscoped read: `src/lib/learning/cohort.server.ts:25-32`; consumers
  `src/lib/delivery/direct-enqueue.server.ts:658,900` (CapRanker and
  `cohort_negative_expectancy`).
- Estimand authority: `learning/payoff.ts:7-19`; divergent re-derivations in
  `learning/walk-forward.server.ts:41` and `learning/cohort.server.ts:42`.
- Interval regimes: `stats/bootstrap.ts` (primary) vs `learning/filter-lift.ts:82`
  and `learning/evidence.ts:101`; `stats/wilson.ts` and `stats/bh.ts` have no
  non-test callers.
- Research starvation: `CANDIDATE_BACKFILL_FETCH_BUDGET` and the candidate
  fetch path in `execution/shadow_resolve.server.ts`.
- Not verified from code: the SQL bodies of `propose_gate_change`,
  `decide_gate_change`, `run_gate_change_automation`, `gate_readiness` — Step 6
  reads them before trusting the owner-manual approval path.
