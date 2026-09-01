# Answers, then three changes

## 1. Closed market — not yet fully avoided

Right now the closed-market check happens **only at send time**, inside pre-send
revalidation (`market_closed` refusal). So the auto trader still queues the order,
spends a broker attempt, gets refused, and then waits 10 minutes (the special
closed-market backoff) before asking again, repeating until the order's time
window elapses. It never sends into a closed market, but it does keep asking.

Fix: add a market-closed gate **before** queueing, next to the existing pre-enqueue
gates (lifecycle stage, broker price grid). If the instrument's market is closed at
enqueue time, record a terminal refusal in the decision log and queue nothing.
The pre-send check stays as the last line of defence for a market that closes
mid-window.

## 2. Repeating the same signal

It does **not** create multiple orders for one setup — there is one live order per
setup per owner, enforced already. What repeats is the retry on that single order:
a momentary refusal (no quote, spread wide, price ran past the limit) re-asks the
same order later with exponential backoff (60s → 900s ceiling), until the owner's
auto-order window expires. So the repetition is retries of one order, not duplicate
orders, and it is capped by the window.

The one genuine waste left is the closed-market case in point 1, which the gate
removes. No other change is needed here; the retry ladder is the correct behaviour
for a truly momentary refusal.

## 3. Admin Intelligence — win rates

The terminal already has replay win rate by grade ("Grade calibration"). Missing is
the **real broker outcome** of the auto trader. Add:

- A new panel "Auto trader — broker-verified outcomes" showing:
  - total: closed trades, win rate, mean R, net profit
  - one row per grade (A+, A, B, C, Unknown) with the same columns
- A "Auto trader win rate" stat card in the top tile grid, with the closed-trade
  count as its sub-line.

All numbers come only from closed broker trade evidence (real fills, real broker
prices, including recovered grades marked as such). Grades proved from the decision
log after their setup was purged are counted and labelled; trades with no
recoverable grade appear under "Unknown" rather than being dropped or guessed.
Zero closed trades renders a zero state, not placeholder numbers.

## Technical notes

- `src/lib/delivery/direct-enqueue.server.ts`: add a market-closed pre-enqueue gate
  using `marketStatus` from `@/lib/market-hours` (same check the pre-send gate uses),
  recording a system decision with reason `market_closed`; add a test alongside the
  existing grid-gate test.
- New server fn in `src/lib/admin.functions.ts` (owner-checked, same as the others)
  aggregating `broker_trade_evidence` closed rows by `signal_grade` /
  `signal_grade_source`; win = broker net profit > 0.
- New `src/components/admin/AutoTraderPanel.tsx`, mounted in
  `src/routes/_authenticated/admin/intelligence.tsx`; stat card added to the grid.
- No schema change required.
