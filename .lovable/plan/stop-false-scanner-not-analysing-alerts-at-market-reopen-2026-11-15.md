# Stop false "Scanner not analysing" alerts at market reopen

## What happened
The alert was a false alarm. Forex reopened Sunday 21:00 UTC and the alert fired at that exact minute. It looks at the last 60 minutes, and those 60 minutes were all weekend, so it found 0 jobs analysed and treated that as an outage. The email then used the "jobs thrown away for waiting too long" wording, even though it says 0 were thrown away.

The scanner is working now. Since reopening it has published 3 setups (21:15 UTC), found no trade on 6 checks and caught 5 duplicates, up to 21:31 UTC. The next check clears the alert by itself, because it now sees real analysis.

## Changes
1. **Reopen grace period:** the alert stays quiet for the first 60 minutes after the weekend reopens, using the scanner's own market hours. It can't open or clear an alert in that hour. After that it works as it does now.
2. **Honest email wording:** the email only says jobs were "closed past their freshness limit" when some actually were. When nothing ran at all, it says "No scan jobs finished in the last 60 minutes" instead.
3. **Close the current alert:** check that the alert from 21:00 cleared on the next run. If it didn't, find out why. It won't be cleared by hand.

## Technical details
- `src/lib/scanner/starvation-watch.server.ts`: add `isWithinReopenGrace(now)` beside `isWeekendClosed` (Sunday 21:00 to 22:00 UTC, taken from the shared calendar). If it's true, return `checked: true, reason: "reopen grace"` without calling the claim or clear functions.
- Choose the email text based on `stale > 0` versus `total === 0`.
- Tests ([INVARIANT]): no alert opens at Sun 21:00 or 21:59 when nothing has run; an alert does open at Sun 22:01 when nothing has run; the email body leaves out the freshness-limit sentence when `stale = 0`.
