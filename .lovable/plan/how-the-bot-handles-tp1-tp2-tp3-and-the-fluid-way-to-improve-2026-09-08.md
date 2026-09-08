# How the bot handles TP1 / TP2 / TP3 — and the fluid way to improve it

## What it does today (verified in code)

Four choices exist for automatic orders:

1. Whole position out at the first target (default).
2. Whole position out at the second target.
3. Whole position out at the third target.
4. Half out at the first target, the rest runs to the second target — the only
   "managed" choice, demo accounts only.

So with choices 1-3 the bot takes **nothing** early: one order, one stop, one
target, and it either reaches that target or the stop. Only choice 4 banks part of
the trade at the first target and then moves the stop on the remainder to the
entry price (break-even) before the remainder aims at the second target.

Limits of choice 4 today:

- The runner stops at the **second** target. There is no three-step ladder to the
  third target.
- The partial is fixed at half, rounded down to what the broker can actually
  split; if it cannot be split, nothing is done rather than guessed.
- After break-even the stop never moves again — the runner gives back everything
  above break-even if price reverses.

## The safer, more fluid way to protect gains and keep the upside

Add one further managed choice and one improvement, both demo-first:

### A. Three-step ladder: part out at first target, part at second, runner to third

- At the first target: close the configured share, move the remaining stop to the
  entry price.
- At the second target: close another share, move the stop to the first target
  (gains now locked, not just break-even).
- Remainder aims at the third target.
- Each step only acts on broker-confirmed facts and is safe to re-run; an
  unconfirmed action is recorded as unknown and never retried blind. A setup that
  never published the target the step needs is refused, not silently exited nearer.

### B. Let the user choose the shares instead of a fixed half

A small set of presets (50/50, 33/33/34, 25/50/25) rather than free numbers, so
every share is a size the broker can actually split; anything unsplittable falls
back to the plain single-target behaviour with the reason shown.

### C. Optional trailing on the final runner

Once the second target is banked, the last portion trails one risk unit behind the
best price reached, so a strong move keeps paying instead of round-tripping. Off by
default; the replay study already measures the trailing variant, so it is switched
on only where the recorded paths support it.

### D. Make the choice legible

Settings shows, in plain words, what each choice gives up: banking early raises how
often a trade ends green but lowers the average size of a win; running the whole
position deeper does the opposite. Signal cards state the exact target the bot will
work, so the reward on the card and the order agree.

## Gating (unchanged rules)

- Every managed choice stays demo-only until the broker itself confirms partial
  closes and stop moves are reliable; live accounts see it greyed out with a reason.
- Statistics stay labelled by the rule that produced them; laddered trades are
  never averaged into single-exit history.
- Nothing is resolved in our favour: an undecidable path stays undecidable.

## Technical notes

- `src/lib/delivery/execution.ts`: add `ladder_tp1_tp2_runner_tp3` to
  `EXECUTION_POLICIES`, rank 3, managed; extend `isManagedPolicy`,
  `POLICY_TARGET_RANK`, labels and `resolveExitPolicy` ceiling logic.
- `src/lib/delivery/manage-positions.ts`: generalise `decideManagedPosition` from
  two steps to an ordered step list (partial at TP1 -> stop to entry -> partial at
  TP2 -> stop to TP1 -> optional trail), still pure, still refusing on any missing
  broker fact or unsplittable volume.
- `src/lib/delivery/manage-positions.server.ts`: per-step durable state
  (attempted / confirmed / unknown) keyed on position + step for idempotency.
- `src/lib/mcp/settings-validation.ts` + `scanner_settings`: new share-preset and
  trail columns, validated; effective policy stays `min(user choice, ceiling)`.
- `src/lib/execution/exit-variants.ts`: add the ladder variant so Admin's exit
  study compares it like-for-like with existing variants.
- Tests: step ordering, idempotency, refuse-on-unknown, ceiling clamping, share
  presets against broker volume steps, ladder variant simulation, plus docs
  contract updates for `docs/EXECUTION.md` and the Guide.
