# Step AUDUSD and USDJPY up, and fix the daily step-up that skipped them

## What I found

Both instruments genuinely pass the data-quality checkpoint today: 12 days of samples, all
five sessions, USDJPY 786 valid samples at 4.7% missingness, AUDUSD 720 valid at 16.7% —
both under the 20% ceiling, both with a fresh passing readiness check this morning.

The daily automatic step-up is switched on and its job is scheduled at 05:40 UTC, and the
endpoint it calls is live. It moved nothing because of a rule inside it:

- Before considering any step, it counts every failed readiness check in the **last 30 days**
  and blocks if more than one failed.
- AUDUSD and USDJPY each have 7 failed checks in that window — all historical, from before
  the quote-quality repair. Their latest checks pass.

So the two instruments are held by history that has already been fixed, and would stay held
for roughly another three weeks. No automatic step-up has ever been recorded, which matches.

## What I will change

1. **Judge readiness by what is current, not by the whole month.** Replace the 30-day
   failure count with a recency rule: the most recent readiness check must pass, and no more
   than one of the last three may have failed. Older failures that have since been repaired
   no longer hold an instrument back. A stale or unreadable readiness history still blocks —
   nothing is assumed.
2. **Step both instruments up now** through the same audited transition path the daily job
   uses, approver `auto-advance`, with the measured evidence attached to the history record:
   AUDUSD and USDJPY move from data validation into measured shadow mode. One rung only.
3. **Let the ladder do the rest.** From shadow they keep climbing on their own trade results
   — one rung per day, only with positive expected R whose confidence interval stays above
   zero, plus a later-period holdout confirmation before order-placement permission. Neither
   has any resolved shadow results yet, so that evidence starts accumulating from today; full
   trading permission is weeks away, not today, and I will not shortcut it.
4. Keep the promotion checkpoint panel and the stage ladder panel showing the same reasons,
   so a held instrument always names what is holding it.

Order-placement permission still does not move real money: the global live switch, your
per-account settings, the risk brakes and the intelligence gate are untouched by any of this.

## Technical detail

- `src/lib/instruments/advancement.ts`: replace `readinessFailures`/`MAX_READINESS_FAILURES`
  with a recency-scoped shape (`latestReady`, `recentFailures` over the last three snapshots)
  in both `degradedEvidenceReasons` and `dataStillClean`; fail closed when the latest snapshot
  is missing or older than the readiness cadence allows.
- `src/lib/instruments/advancement.server.ts`: collect the last three readiness snapshots per
  instrument, ordered, instead of a 30-day failure count.
- Unit tests in `src/lib/instruments/__tests__/` for: repaired history no longer blocks,
  current failure still blocks, missing/stale snapshot blocks.
- Apply the two transitions by invoking the existing advancement run once (cron-authorised
  endpoint), so the transitions are recorded and emailed exactly like a scheduled run —
  no direct stage writes, no migration.
- Docs: `docs/INSTRUMENT-LIFECYCLE.md` readiness wording updated to the recency rule.

## Expected end state

AUDUSD and USDJPY sit at shadow with their promotion recorded in the transition history and
an owner email sent, the daily job stops being blocked by already-repaired readiness history,
and each instrument continues up the ladder as its own measured results arrive.
