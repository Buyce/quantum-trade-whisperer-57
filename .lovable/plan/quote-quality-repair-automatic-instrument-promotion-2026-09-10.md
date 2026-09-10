# Quote quality repair + automatic instrument promotion

Two pieces. Nothing here invents a price, loosens a threshold, or turns on the global
live-execution switch.

## Part 1 — the quote quality problem

What the stored samples actually show (last 14 days):

- Almost every rejected sample is one class: `zero_spread` — the broker answered with
  bid exactly equal to ask. GBPUSD 368, EURUSD 354, USDCAD 241, AUDUSD 142, USDCHF 95.
- Those quotes are **fresh**, not stale: the broker's own timestamp is 0.2–4 seconds
  old. So this is not a thin-hour stale price.
- They are spread over 188 distinct hours for GBPUSD, heavily concentrated in the
  Asian hours, and they are the only reason GBPUSD (44%) and USDCAD (31%) fail the
  20% ceiling.
- The spread sampler asks for **one** quote per instrument per slot and records
  whatever comes back. Readiness, by contrast, already re-asks up to three times —
  which is why readiness mostly passes while sampling does not.

A degenerate mirrored tick immediately after a subscription is created is the most
likely cause (the sampler requests prices without keeping a subscription warm), but
that is a hypothesis, not a confirmed fact, so the first step measures it.

1. **Measure before changing behaviour.** Have the sampler, when a tick comes back
   degenerate, re-ask once and record what the second answer was, without changing
   which sample counts as evidence. One or two slots of that tells us whether a
   re-ask fixes it, whether a warm subscription is needed, or whether this broker
   genuinely publishes zero spreads at those hours.
2. **Then apply the fix the measurement supports** — a bounded re-ask (2 attempts,
   short escalating delay), and/or keeping the price subscription warm for
   measurement reads only. The instrument ceiling stays 8; the per-run request
   ceiling rises from 10 to 16 so a retry cannot be silently starved. Worst case
   1,536 broker reads/day instead of 768; typical case far lower because only
   degenerate ticks retry.
3. **Classification stays strict.** A zero or crossed spread is still not evidence.
   Every attempt count and the reason of the last attempt are stored, so a broker
   that really does quote zero spreads still fails and says how hard we tried.
4. Same bounded re-ask, with a longer backoff, for the conversion-leg proofs that
   are currently flapping on USDCHF and USDCAD.
5. Re-read the evidence afterwards and report the real missingness per instrument.

If the measurement shows the broker genuinely publishes zero spreads in those hours,
I will say so and propose an hour-aware rule instead of retrying it away.

## Part 2 — automatic promotion, all the way

Today only `data_validation -> shadow` has a written benchmark. Automatic promotion
to the point of placing orders needs the two later steps defined with the same
rigour, so this part adds them.

The ladder and the evidence each step requires:

```text
data_validation -> shadow            existing checkpoint: 5 trading days, 200 valid
                                     samples, every session, missingness <= 20%,
                                     fresh passing readiness, stable verified
                                     provider symbol, derived spread floor
shadow          -> signals_only      enough resolved shadow outcomes for this
                                     instrument (descriptive evidence tier: samples
                                     and independent clusters), expected R positive
                                     with the bootstrap lower bound above zero,
                                     readiness still clean, spread statistics stable
signals_only    -> execution_approved walk-forward holdout confirmation for the
                                     instrument's cohort, published-signal outcomes
                                     at the same evidence tier, execution-quality
                                     evidence (spread, slippage proxies) inside
                                     limits, no readiness failure in the window
```

Rules that make this safe:

- **One step per instrument per day.** No instrument jumps two stages, so there is
  always a measured stage in between.
- **Automatic demotion, not just promotion.** If readiness fails twice in a row,
  missingness breaches the ceiling, or realised expectancy turns negative at the
  same evidence tier, the instrument steps back down automatically and you are
  emailed. Evidence decay must cost an instrument its stage.
- **Every transition goes through the existing audited path** (`transition_instrument_stage`)
  with the evidence recorded, approver `auto-advance`, and the expected current
  stage supplied — so a concurrent manual change cannot be overwritten.
- **A kill switch.** One control turns automatic advancement off; when it is
  unreadable, advancement does not run. Manual transitions keep working exactly as
  now.
- **What `execution_approved` does and does not mean.** It only means the engine may
  place orders for that instrument. Whether real money moves is still decided by the
  global live-execution switch (off), your per-account automatic-order settings, the
  risk brakes and the intelligence gate. Automatic promotion does not touch any of
  those. This is the last place where your explicit decision remains required, and I
  am keeping it.

Notification: an email naming the instrument, the direction of the move, and the
measured evidence behind it, plus a record in Admin.

## Admin surface

The Promotion checkpoint panel becomes a stage-ladder view: each instrument's current
stage, the next step, whether it is met, every unmet criterion with the measured
value beside it, and a list of recent automatic transitions with their evidence.

## Technical detail

- `src/lib/instruments/advancement.ts` — pure per-step gates and verdicts, unit
  tested including fail-closed cases (no rows, unreadable stage, stale readiness).
- `src/lib/instruments/advancement.server.ts` — evidence collection via database-side
  aggregates (same approach as the checkpoint fix, so no row-ceiling truncation),
  reusing `stats/evidence.ts`, `stats/walk-forward.ts` and the payoff aggregates.
- `src/routes/api/public/cron/advance-instruments.ts` — cron-authorised, runs after
  the daily readiness pass; bounded, idempotent, one step per instrument.
- Sampler retry in `src/lib/telemetry/sampler.server.ts` reusing the existing
  `quote-retry.ts`; request ceiling raised in `src/lib/telemetry/sampler.ts`.
- New app-email template for promotion/demotion notices.
- Docs: `INSTRUMENT-LIFECYCLE.md` gains the two new gates and the automatic path;
  `OPERATIONS.md` gains the runbook and the kill switch.

## Expected end state

Sampling missingness reported honestly and, if the re-ask works, materially lower.
USDJPY and AUDUSD advance to shadow on the next run without you doing anything, and
each instrument keeps climbing as its own evidence arrives — with every step, and
every step back, recorded and emailed. The global live-execution switch stays under
your control.
