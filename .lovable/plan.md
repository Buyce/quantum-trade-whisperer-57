# The 7 losses were not duplicates — what actually happened, and the missing brake

## Straight answer to your question

No. The last four pieces of work do **not** prevent what you saw in that table, because
those seven trades were **not** duplicates and were **not** the same signal.

I checked the broker records behind the screenshot. The seven XAUUSD shorts came from
**seven different signals**, each with its own planned entry (4357.76, 4359.10, 4359.26,
4359.58, 4360.35, 4364.51/4365.40, 4366.03), all entered between 03:53 and 04:22 UTC.

- Duplicate prevention refuses a second order only when the instrument, the direction
  **and the entry price** (within one broker tick) are the same. Different entries, so
  nothing to refuse. It behaved exactly as designed.
- The rows that looked doubled in the totals are your **two connected accounts**, not two
  orders on one account. One order per signal per account — no duplication anywhere.

So the real cause is different: **many separate Gold short setups fired inside half an
hour, and every one of them was the same bet.** Gold rose, and they all lost roughly 1R
each. The losing-run pause then did its job and stopped the eighth — but by then seven
correlated losses had already happened.

## What is missing

There is currently no limit on **how much of the same bet** can be live at once.
Existing ceilings count orders, not correlation:

- concurrent automatic orders (was 50 on this account) — counts every instrument together
- automatic orders per instrument per day — a daily count, not a "right now" count
- losing-run pause — reacts **after** the losses have closed

Nothing says "you already have three Gold shorts working; don't open a fourth."

## Proposed fix: a correlated-cluster brake

One new, always-evaluated refusal at order time, plus one short cooldown. Both are
customer-owned settings in the same Settings panel as the other automatic order rules.

1. **Same-bet limit (live count).** Refuse a new automatic order when the account already
   has N unresolved automatic orders (resting or filled) on the **same instrument and the
   same direction**. Default **2**, selectable 1–5, or off. Counted from the same
   unresolved-delivery source the concurrent ceiling already uses, so no new notion of
   "open" is invented.
2. **Cool-off after a loss on the same bet.** After a broker-confirmed loss on an
   instrument+direction, refuse new automatic orders on that same instrument+direction
   for a short window. Default **60 minutes**, selectable 30/60/120 minutes, or off. Only
   broker-confirmed closed losses count; a missing broker record never starts a cool-off
   and never refuses.

Both refusals are recorded in the decision trail with their own reasons, so the feed can
say plainly "you already have 2 Gold shorts working" or "Gold shorts are cooling off after
a loss, resumes at HH:MM", instead of a generic refusal.

Applied to the seven trades above, the same-bet limit at 2 would have allowed the first
two and refused the other five: about **-2,400** instead of about **-8,600** on the
account in your screenshot.

## What does not change

- Duplicate prevention and the losing-run pause stay exactly as they are.
- No open or filled broker position is touched by either new rule; they only refuse *new*
  orders.
- Live execution stays disabled; this is demo-account behaviour today.
- No estimated or invented broker data — a value that cannot be read means "do not refuse
  on the count" for the live-count rule and "no cool-off" for the loss rule.

## Technical notes

- `src/lib/delivery/exposure.ts` (or a new `correlated-cluster.ts`): pure evaluation of
  both rules, given the unresolved deliveries and recent broker-confirmed losses.
- `src/lib/delivery/direct-enqueue.server.ts`: evaluate after the existing ceilings and
  before dispatch; add `same_bet_limit_reached` and `same_bet_cooldown_active` to
  `enqueue-log.ts` copy.
- Migration: two `scanner_settings` columns (`max_same_bet_orders`,
  `same_bet_cooldown_minutes`) with defaults, plus grants unchanged.
- Settings UI: two controls inside "Automatic order rules"; MCP settings schema updated.
- Tests: cluster-limit unit tests, fail-open-on-unknown tests, and a replay of the
  2026-09-09 XAUUSD sequence asserting five refusals.
- Docs: `docs/RISK-GUARDIAN.md` and the Guide.
