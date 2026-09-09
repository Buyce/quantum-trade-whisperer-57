# Fix: turning the pause off should release the hold immediately

## What is actually happening

You found a real bug, and it is a display/state bug rather than a trading one.

- Orders themselves are already released. The queue and the pre-send check both
  re-evaluate your limits live, and when the losing-streak protection is switched
  off they return "no hold", so new automatic orders are allowed again.
- What does not clear is the stored hold record. The evaluator skips any account
  whose owner has the protection switched off, so it never writes an update for
  that account, and the old row keeps `paused = true` with the old release time.
- The banner and the feed read that stored row, so they keep announcing a pause
  that is no longer enforced — until the previous window's end time passes.

So the app is telling you something untrue, and it also means the cancelled-order
counters from the last pause stay on screen.

## The fix

1. When an armed account's owner has no limit configured (protection off, or
   every limit left at 0), write a cleared record instead of skipping the
   account: not paused, no reason, no detail, no release time, cancellation
   counters back to 0. Peak-equity history stays untouched so nothing is lost if
   the protection is switched back on.
2. Make the hold read self-consistent: the hold list used by the banner and the
   feed only returns a paused row when that account's owner currently has the
   protection configured. That way the banner disappears the moment you save the
   setting, without waiting for the next evaluation pass.
3. Keep every other rule exactly as it is: orders already resting or filled at
   your broker are still untouched, and no limit is loosened.

## Technical notes

- `src/lib/risk/brakes.server.ts` — in `evaluateAccountBrakes`, collect accounts
  whose limits are not configured into a separate list and push a "cleared"
  upsert for them (`paused: false`, `pause_reason/pause_detail/paused_at/
  resume_after/resume_boundary: null`, counters `0`), preserving existing
  `peak_equity` / `peak_equity_at` read from `account_risk_state`. This requires
  reading existing state rows for those accounts too, but no broker-evidence
  read is paid for them.
- `src/lib/execution.functions.ts` — `getRiskHolds` additionally reads the
  caller's `scanner_settings` brake fields and drops paused rows when
  `brakesConfigured(readBrakeLimits(settings))` is false.
- Tests: extend `src/lib/risk/__tests__/` with a case that a previously paused
  account is cleared once its limits are switched off, and a case that the hold
  read returns nothing while the protection is off.
- Docs: note the clearing behaviour in `docs/RISK-GUARDIAN.md`.
- Verify with focused tests, full suite, typecheck and build.
