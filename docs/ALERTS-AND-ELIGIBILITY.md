# Alerts and eligibility

## Purpose

Decide, per user, whether an already-published setup may be **shown** (feed) or
**announced** (alert). Nothing here conditions publication, grading, replay,
research enrolment or any statistic.

## Current behaviour

There is exactly one implementation — `src/lib/delivery/eligibility.ts` — shared
by the alert fan-out, the feed and its realtime toast, and the MCP `list_signals`
tool. A SQL mirror is deliberately absent, because a second implementation in
another language is how these four call sites drifted before.

### Rules, in order

1. `instrument_filtered` — instrument not in the user's list.
2. `session_filtered` — trading session not in the user's list. A **missing**
   `market_context` row does not suppress the signal: the pipeline writes context
   after the signal, so `null` is treated as "not yet known".
3. `below_min_grade` (feed) / `below_alert_grade` (alert) — the two channels have
   separate thresholds on purpose.
4. `expired_retention` — outside the grade's retention window.
5. `daily_cap_reached` — see below.

A resolved signal is still base-eligible. Hiding resolved setups is the user's
"Active only" display toggle, not an eligibility rule.

### Daily cap

The cap counts the channel's **base-eligible graded (A+/A/B)** signals of the UTC
day, ordered `(detected_at ASC, id ASC)`. The first `cap` are inside the cap; the
rest are `daily_cap_reached`. `cap = 0` means unlimited, which is the default.
C-grade never consumes cap. Feed and alert maintain separate sequences because
their grade thresholds differ. The frame is built by `buildCapFrame` over the
whole UTC day, not over the currently loaded page.

There is no global daily ceiling in the scanner. The cap is purely a per-user
delivery preference.

### Channels

Web/Android push (VAPID) and transactional email briefs, both fired only for
alert-eligible signals. Execution deliveries additionally require alert
eligibility before dispatch.

## Inputs

An `EligibilitySignal` (id, `detected_at`, instrument, grade, `trading_session`),
`EligibilitySettings` (instruments, sessions, `min_grade`, `alert_min_grade`,
`daily_setup_cap`), the day frame, and `now`.

## Outputs

`{ eligible, reason }`. Callers surface the reason verbatim rather than inventing
an explanation.

## Provenance

Signal fields are broker-derived; settings are user-chosen.

## Failure behaviour

The module is pure — no Supabase, no clock read beyond the `now` argument — so it
cannot fail for I/O reasons. Unknown session ⇒ not filtered. Unreadable settings
upstream ⇒ the caller falls back to its documented default rather than guessing a
threshold.

## User-facing meaning

An empty feed can mean either "the scanner published nothing" or "your filters
excluded everything". These are different statements and the UI distinguishes
them. **An empty filtered view is never presented as evidence of a scanner-wide
no-trade condition.**

## What eligibility does not guarantee

Delivery. Push subscriptions expire, email can be suppressed, and a device can be
offline.

## Implementation

`src/lib/delivery/eligibility.ts`, `day-frame.ts`,
`src/lib/scanner/alerts.server.ts` (notification-only), `src/lib/push.functions.ts`.

## Tests

`src/lib/delivery/__tests__/eligibility*.test.ts`,
`src/lib/mcp/__tests__/list-signals.behavior.test.ts` (invariants that no empty
result may claim a scanner-wide condition).
