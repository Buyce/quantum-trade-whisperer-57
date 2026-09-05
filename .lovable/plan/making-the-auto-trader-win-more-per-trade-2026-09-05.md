# Making the Auto-Trader Win More Per Trade

This replaces the earlier loss-containment plan. That plan was about losing less. This one is about the actual question: more wins, and more won per trade.

## What the data actually says

I measured the real closed trades and the replay engine. Everything below is a measured number, not an estimate.

**The core problem is not the win rate. It is that every win is capped.**

Every automatic order exits at the first target, and the first target sits at almost exactly 1R for every grade (A 0.94, B 1.02, C 1.00). Every loss is 1R. So a win is +1 and a loss is -1.

That means profit depends entirely on winning more than half the time:

| Source | Trades | Win rate | Average per trade |
|---|---|---|---|
| Real broker, B-grade | 52 | 38% | -0.29R (-2,319) |
| Real broker, C-grade | 66 | 52% | +0.27R (+7,111) |
| Replay, all filled | 328 | 51.5% | +0.04R |

A 1-to-1 payoff at a ~51% win rate is a coin flip. No amount of better signal picking fixes this reliably, because the win rate would have to be pushed far above 55% and held there. The fix is to change the payoff.

**The winners and losers behave very differently, and that is the opening.**

Measured across 169 replay winners and 147 losers:

- Winners barely go against us first. Median worst drawdown on a winner is **0.265R**; 73% of winners never go more than 0.5R against us.
- Losers go *in our favour* first, then reverse. Median best excursion on a loser is **0.535R**; 36% of losers travel 0.7R or more in our favour before failing.

So our stop is far wider than winners actually need, and losers repeatedly hand us a profit we never take.

**Letting winners run further does not work.** I checked before proposing it: only 10 of 96 B-grade winners and 11 of 72 C-grade winners ever reached the second target. Extending to the second target would give back the sure +1R on 85-90% of winners. This idea is closed, not deferred.

## The plan

### 1. Build the counterfactual replay harness first

Nothing below gets shipped on my arithmetic. We already store the full price path per setup (best excursion, worst excursion, bar-by-bar cursor). The harness re-runs already-resolved setups under an alternative stop-and-exit rule and reports the honest distribution of results, using the existing frozen replay-version and as-of provenance so the comparison is reproducible.

This is the prerequisite for items 2, 3 and 4. It reads history only and touches nothing live.

### 2. Tighter structural stop — the biggest lever

Because winners rarely retrace past ~0.5R, a stop placed closer (while still structurally valid behind the pattern) keeps most winners and makes each one worth more relative to the risk taken. On the measured distribution this trades roughly 20% of winners for a payoff that rises from 1.0 to about 1.6 per win — a materially positive expectancy instead of a coin flip.

The stop must remain anchored to real structure. If a tighter stop would sit inside the pattern, the setup keeps its current stop or is not taken. No stop is ever moved to a level the structure does not support.

### 3. Scratch-stop on losers that go our way first

For the 36% of losers that travel 0.7R or more in our favour, move the stop to break-even once that level is reached, turning a full loss into roughly nothing. The harness measures the cost — winners that reach 0.7R, retrace, and get scratched — before this ships. If the cost exceeds the saving, it does not ship.

### 4. Cohort gating on instrument, direction and session

There are large, consistent differences the trader currently ignores completely. Measured:

- Gold shorts: 1 win in 18 real trades (-7,867). Gold longs: 10 wins in 12 (+7,073).
- GBPAUD shorts outside New York: 0 wins in 11 (-4,535).
- EURUSD longs in London: 8 wins in 10. EURUSD longs in Tokyo: 2 in 11.

We already have the statistics machinery for this (confidence intervals, clustered bootstrap, multiple-comparison correction, pass-versus-reject lift). It is currently wired to only three gates and ignores instrument, direction and session. Extend it to those, and refuse only cohorts that fail the existing evidence bar. No cohort is blocked on a hunch.

### 5. Rank the daily cap by evidence, not by clock

The daily order cap currently fills first-come, sorted by detection time. With a 2-order daily default, that wastes the cap on whatever appeared first. Rank instead by the measured expectancy of the setup's cohort.

**Not** by the confidence score. I tested it: it does not order outcomes (16-20 scores -0.47R, 20-40 scores +0.18R, 40-59 scores -0.05R). Ranking by it would be ranking by noise. Leaving it as display-only.

### 6. What I am not claiming

The real-money grade inversion — C-grade outperforming B-grade — is 52 and 66 trades. Replay disagrees slightly. That is inside the noise, so I am not treating grading as broken and not reordering grades. Item 4 answers it properly with the evidence bar applied.

### Rollout

Harness and measurement first. Then the stop and exit changes go to demo auto-trading only, and only cohorts and rules that clear the existing evidence gates. Live execution stays off and untouched throughout. Demo auto-trading keeps running the whole time.

## Technical notes

- New replay harness alongside `src/lib/execution/replay-v2.ts`, reading resolved `shadow_executions` rows; reuses `max_favorable_excursion_r` / `max_adverse_excursion_r` and the `replay_versions` registry. Frozen `as_of` provenance preserved.
- Stop-geometry changes flow through the existing unified sizing math so Model 1 remains authoritative; no risk percentage is raised anywhere.
- `single_exit_first_target` stays the only execution policy — items 2 and 3 change stop placement and stop movement, not the number of exits.
- `TunableGate` in `src/lib/learning/readiness.ts` extends from three gates to include instrument, direction and session cohorts; `filter-lift.ts` verdict thresholds and Benjamini-Hochberg correction unchanged.
- `capSequence()` in `src/lib/delivery/eligibility.ts` gains an evidence-ranked ordering; cap size, grade eligibility and UTC-day frame authority unchanged.
- Binding rules preserved: no fabricated or inferred broker evidence, advisory limits never imply broker state, Model 1 sizing authoritative, promotions service-role only, live execution disabled.
