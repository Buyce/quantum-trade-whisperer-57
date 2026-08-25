# Why the orders show "Rejected by broker" — and how to fix it

## What the evidence actually says

Your broker never saw these orders.

Every rejected row in the delivery ledger has `broker_retcode`, `broker_retcode_string`,
`submitted_at`, `submitted_volume`, `submitted_entry` all empty. Nothing was submitted.
The refusal came from P-Trades' own pre-send revalidation, with the reason
`price_beyond_max_acceptable_entry`, and the History card then displays that internal
reason under the heading "Broker result" with the badge "Rejected by broker".

So there are two separate defects.

## Defect 1 — the chase ceiling is applied to a pending limit order

The rejected XAUUSD setups are all LONG with entry `4634.14`-`4634.39` and a
do-not-chase ceiling around `4635.8`-`4636.0`. The live ask at refusal time was
`4644.85`-`4649.37`.

The current check refuses a buy when the market ask is above the ceiling. That rule is
correct for a *market* entry: buying at 4649 when the plan assumed 4634 destroys the
graded payoff. But P-Trades does not send market orders — it sends a pending
`buy_limit` at the planned entry. A buy limit at 4634 with market at 4649 cannot slip:
the price has to fall to 4634 before it fills, so the fill is at the planned price or
better. This is precisely the safest case, and it is the one being rejected.

The genuinely dangerous case for a pending buy limit is the opposite one — market
already at or below the limit price, where the order either fills instantly at an
unplanned price or the broker refuses the price outright. That case is currently not
checked at all.

### The correction

- Keep the chase ceiling as the rule for any market-entry path and for what the trader
  is told in the feed and alerts. It is unchanged there.
- For pending limit destinations (bridge and connected-account alike), replace the
  ceiling test with the pending-limit validity test:
  - `buy_limit`: refuse when the current ask is at or below the limit price, plus the
    broker's minimum stop/limit distance. Market above the limit is fine.
  - `sell_limit`: refuse when the current bid is at or above the limit price by the
    same distance. Market below the limit is fine.
- Use the broker-reported minimum distance already loaded from the account/symbol
  specification. If the distance cannot be read, fail closed with a named reason —
  no guessed distance.
- New named reason, e.g. `limit_price_not_on_pending_side`, so the ledger keeps saying
  exactly why. The existing `price_beyond_max_acceptable_entry` reason stays in the
  vocabulary for market-entry paths and for the historical rows already recorded.
- Both revalidation call sites (the plan check and the post-sizing execution check) get
  the same treatment; the second check stays, so a price that moves during sizing is
  still caught.

Everything else in the pre-send stack is untouched: eligibility, quote freshness,
spread ceiling, grade, sessions, caps, order ceiling, intelligence gate, sizing,
lifecycle, live gates.

## Defect 2 — a pre-send refusal is labelled as the broker's decision

`brokerOrderStatus` maps delivery state `rejected` to "Rejected by broker" and shows
the internal reason under "Broker result", even when no submission happened.

### The correction

- When a rejected row has no broker retcode and no `submitted_at`, label it
  "Not sent — refused by P-Trades" and show the reason under "P-Trades check", with
  plain-language text for each reason instead of the raw enum.
- Only a row that carries a broker retcode keeps "Rejected by broker" and the "Broker
  result" heading.
- Same distinction for the `unknown` state: a row that was never submitted is not an
  unknown broker outcome.
- Historical rows are not rewritten; they simply render honestly under the new rule.

## What this does not change

- Live execution stays globally disabled. This work does not enable it.
- No fabricated prices, quotes, volumes or broker states. A missing broker fact stays
  missing.
- Wave 1 stays unpublished, Wave 2 stays disabled.
- Grading, sizing, alerts and statistics are untouched.

## Technical notes

- `src/lib/delivery/execution.ts` — add the pending-limit side test next to
  `withinMaxAcceptableEntry`; add the new reject reason to the reason union.
- `src/lib/delivery/revalidate.server.ts` — swap the two ceiling checks (lines ~460 and
  ~571) for the pending-limit test, sourcing minimum distance from the already-loaded
  spec and failing closed when absent.
- `src/lib/history/broker-orders.ts` — derive "submitted vs never submitted" from
  retcode/`submitted_at` and split the rejected/unknown labels accordingly.
- `src/components/history/AutomaticOrders.tsx` — heading text follows the status kind.
- Tests: pending-limit acceptance with market far above a buy limit, refusal when
  market is below it, fail-closed with no broker distance, unchanged market-entry
  ceiling behaviour, and History labelling for submitted vs never-submitted rejections.
- `docs/EXECUTION.md` — record that the chase ceiling governs market entries while
  pending limits are validated on the correct side, and the reason vocabulary change.
