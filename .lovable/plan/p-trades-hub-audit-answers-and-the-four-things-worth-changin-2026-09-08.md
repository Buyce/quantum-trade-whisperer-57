# P-Trades Hub — audit answers, and the four things worth changing

Everything below was checked against live data and the code tonight, not inferred.

## 1. Why only two gates show training data

This is by design, and the panel is describing it badly.

Eight checks decide whether a setup is published. Five of them (structure,
candles present, grade, 15-minute direction, risk defined) reject a setup
*before* an entry price, a stop and a risk distance exist. With no entry and no
stop there is no plan, so there is nothing to replay against real candles — the
rejected setup can never produce a measurable outcome. Those rows are stored
honestly as "structurally not evaluable": 1,188 of 2,014 captured evaluations,
all of them 15-minute-direction rejections.

Only three checks can reject a setup that still has full geometry: risk ceiling,
headroom and reachable reward. Live counts of rejected-and-replayed rows:

- risk ceiling — 65 training, 15 held-out
- reachable reward — 48 training, 12 held-out
- headroom — 0 (allowed in principle; no setup has yet been rejected by headroom
  alone)

So nothing is blocked and no data flow is broken. The five structural checks will
never have a rejected arm, and the panel currently tells you they are "waiting
for 30 observations", which is untrue and misleading.

**Change:** label those five as "cannot be measured this way — rejected before a
plan exists", and show headroom as "allowed, none seen yet". Keep the honest
"needs 30" wording only for the two gates that genuinely accumulate data.

## 2. Why so many scans ended stale

That count is history, not the present. Stale results per hour today: 27, 6, 7,
16, 13, 22, 20, 33 up to 18:00 UTC — then **0, 0, 0, 0** from 19:00 onward. The
scanner's own database→app calls now read 100/123/121/124 successful with zero
failures across those same hours. The queue-throughput repair went live at
around 19:00 and the fault stopped immediately.

The "864 jobs / 414 stale" card counts a rolling 24 hours, so it will keep
showing the pre-fix damage until tomorrow evening.

**Change:** add a "last 3 hours" line beside the 24-hour figures so a repaired
engine reads as repaired instead of looking permanently broken.

## 3. Is the research candidate funnel working?

Yes. 2,014 evaluations captured since 25 August, latest 22:45 tonight, every one
with a complete check list. 827 carry a genuinely replayable plan; 812 have been
enrolled for forward testing (647 published, 165 rejected). 14 replayable rows
are not yet enrolled — that is the per-run budget catching up, not a blockage.

## 4. Filter Lift — this is the one real weakness

Filter Lift is computing and its arms are correct, but almost every slice reports
"insufficient coverage" rather than a result. Reason: 222 of 812 research rows
have never been replayed, the oldest waiting since 28 August. Coverage sits at
0.74 against a 0.95 requirement, so the engine correctly refuses to state a
number.

The cause is deliberate throttling. Research rows are only replayed against
candles production already fetched, plus **3** extra history fetches per run.
Rejected setups on instruments production is not currently scanning therefore
almost never resolve, and the backlog is now permanent rather than temporary.

**Change:** raise the research history-fetch allowance from 3 to 12 per run and
add a small dedicated catch-up pass that always takes the oldest unresolved
research rows first. Production replay keeps its own untouched budget and still
runs first, so live labelling cannot be slowed. No freshness rule, grading rule
or execution gate changes.

## 5. What is not being changed

Live execution stays as it is. The 15-minute freshness rule stays. No seeded,
mock or example data anywhere — a slice with too little evidence keeps reporting
that instead of a number.

## Technical detail

- `src/lib/stats/walk-forward.ts` / `WalkForwardPanel.tsx`: derive a per-gate
  measurability class from `research_candidates.counterfactual_class` and the
  frozen `COUNTERFACTUAL_FAIL_GATES` whitelist; render three distinct states
  (structurally unmeasurable, awaiting occurrence, awaiting samples) instead of
  one blanket sample-shortfall string. Tests in
  `src/lib/stats/__tests__/walk-forward.test.ts`.
- `src/lib/engine-status.ts` + `EngineStatusPanel.tsx`: add a 3-hour scan-result
  window alongside the 24-hour totals; classifier unchanged.
- `src/lib/execution/shadow_resolve.server.ts`:
  `CANDIDATE_BACKFILL_FETCH_BUDGET` 3 → 12, and order the candidate read by
  oldest `detected_at` with an explicit oldest-first catch-up slice;
  `MAX_ROWS_PER_RUN` and `RESEARCH_MAX_ROWS_PER_RUN` unchanged; existing
  candidate-resolver tests extended.
- `docs/RESEARCH-AND-SHADOW.md` and `docs/PERFORMANCE-AND-STATISTICS.md`: record
  that five gates are structurally unmeasurable by construction.
- Verify after: coverage on the global Filter Lift slice rising above 0.95, the
  unresolved research count falling from 222, and stale staying at zero.
