# Fix the three unreadable Admin Intelligence panels

Three panels — Instrument lifecycle and telemetry, Commissioning status, Economic events — show "diagnostics could not be read". The cause is confirmed, not guessed.

## What is actually wrong

Those three panels are the only ones that fetch their data with the service-role backend client. Their database functions each start with an owner check based on the signed-in user's email taken from the session token. A service-role call carries no user session, so the email is empty, the check fails, and the database returns `forbidden`.

Verified directly: calling `get_admin_instrument_diagnostics` and `get_admin_news` with the service key returns `400 / "forbidden"`. Every panel that works today (engine status, intelligence tiles, candidate funnel, payoff) calls its function with the signed-in owner's identity instead.

A second, smaller issue: `get_admin_instrument_diagnostics` is the only one of the three not executable by signed-in users at all, so switching identity alone would still fail for it.

## The fix

1. Read the three diagnostics functions with the owner's own session identity (the same path the working panels use), keeping the existing server-side owner-email check before any database call. The privileged client stays reserved for genuinely service-role-only work such as the payoff recompute and telemetry-control reads.
2. One migration: allow signed-in users to execute `get_admin_instrument_diagnostics`, revoked from anonymous/public. The in-database owner guard is unchanged and remains the actual gate, so this grants nothing to non-owners.
3. Make the three failure states diagnosable: when a read does fail, the panel shows the real error text instead of a generic sentence, so the next failure is not another blind panel.

Nothing about grading, alerts, the scanner, execution switches, lifecycle stages or any user-facing page changes.

## Two things on that screen that are not bugs

- "Replay: market-data fetch failed at the provider" — a truthful report of upstream candle-fetch failures on the replay engine. Left as-is; it is the intended honest message.
- "Last research error: observation write exceeded deadline" — a durable health note from research capture (which is dark/off), also truthful. Left as-is.
- The older "C-Grade setups are never executed automatically" decision rows are historical rows written before the C-grade opt-in shipped; new decisions use the current wording. No back-editing of recorded decisions.

## Verification

Reload `/admin/intelligence` as the owner and confirm the three panels render live rows (or an explicit empty state where there genuinely are no rows), then run lint, typecheck, build and the full test suite.
