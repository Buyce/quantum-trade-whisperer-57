# Why the engine shows PAUSED with 5 consecutive failures

## What I found (read from the live backend, not inferred)

Two separate things are stacked on that one card.

**1. Your data provider is refusing candles.** Every failed scan job since ~22:00 UTC
yesterday carries the same broker-side error:

```text
MetaApi 400 for XAUUSD H4: {"error":"ValidationError",
"message":"To allow market data access please top up your account."}
```

That is MetaApi rejecting market-data requests for billing reasons, not a bug in
the app. Failure pattern by hour (12 failed jobs per hour = 3 instruments × 4
attempts):

```text
22:00 partial   23:00 all failed   00:00–03:00 all failed   03:55–04:00 succeeded again
```

So the account is intermittently allowed through (the last two cycles at 03:55
and 04:00 published/deduplicated normally, and the market is closed for the
weekend anyway), but most cycles in the last six hours were rejected outright.

**2. The card is mislabelled, and the breaker never resets itself.** The tile says
"Scan engine — PAUSED", but the flag it reads (`shadow_engine_state.paused`) is
the **shadow replay / statistics** engine's circuit breaker, not the 15-minute
scanner. It trips when five consecutive hourly resolve passes see every
instrument's candle fetch fail — which is exactly what the MetaApi rejections
caused. Once tripped, the hourly job returns early before it can record a
success, so the counter is stuck at 5 and the breaker stays closed forever until
someone resets it by hand. Effect today: open shadow rows have not been replayed
since 22:07 UTC yesterday, so payoff/regime statistics have stopped advancing.

The live 15-minute scanner itself is **not** paused by this flag — it kept
running and failing on the provider error, then succeeded again at 03:55.

## What you need to do outside the app

Top up / re-enable market data on the MetaApi account. Nothing in this plan can
fix a provider-side billing block, and no fallback data will be substituted.

## Proposed changes in the app

1. **Label the tile truthfully.** Split the single "Scan engine" tile into
   "Scan engine (15-min cycles)" driven by real `scan_queue` outcomes in the last
   hour, and "Shadow replay engine" driven by `shadow_engine_state`. Show the
   provider error verbatim where it applies.

2. **Make the breaker self-healing.** Keep the five-failure trip (it exists so a
   dead data source is not hammered hourly), but allow a paused pass to run one
   probe attempt after a cooldown window instead of returning early forever. A
   successful pass clears `consecutive_failures` and un-pauses; a failed probe
   leaves it paused and extends the cooldown. No change to replay maths, cohort
   scoping or what counts as a failure.

3. **Add an admin reset control.** An admin-only action on the intelligence
   terminal that clears the breaker immediately once the provider is funded,
   instead of needing a database edit.

4. **Distinguish provider refusal from engine defect in the copy.** When the last
   error is a provider validation/billing rejection, the tile and the guide text
   say so plainly ("market-data access refused by the broker data provider —
   scanner results are missing, not empty") so it can never be read as a
   scanner-wide "No Trade".

## Explicitly not changing

Scanner maths, grading, replay semantics, R maths, eligibility, sizing, RLS, and
MetaApi call volume per cycle. The probe adds no extra calls on a healthy pass and
at most one bounded pass per cooldown while paused.

## Technical notes

- Breaker state: `shadow_engine_state.paused`, `consecutive_failures`,
  `last_error`, `last_run_at`; written only by `noteShadowRun`
  (`src/lib/execution/shadow_worker.server.ts`).
- Early return to change: `src/routes/api/public/cron/shadow-resolve.ts` and the
  same guard in `src/routes/api/public/worker/shadow.ts`.
- Tile source: `src/routes/_authenticated/admin/intelligence.tsx` plus the
  aggregate in `get_admin_intelligence()`; scan-side health comes from
  `scan_queue` results already aggregated there.
- Cooldown timestamp needs one nullable column on `shadow_engine_state`
  (service-role only, matching existing grants).
