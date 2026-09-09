# Answers, and a losing-run cancel rule for similar orders

## 1. Does the pause touch trades already open at your broker?

No. Verified in the code: the pause is asked in exactly two places, both before an
order is sent (when it is queued, and again immediately before submission). The
part that manages open positions has no connection to it at all.

So while the pause is on:

- Positions already open keep their stop loss and take profit exactly as placed.
- Nothing is closed early, held longer, or nudged. Your broker closes them on the
  prices already attached to them.
- Orders still resting unfilled are also left alone today — they simply expire at
  the end of your automatic-order window if price never reaches them.

The only effect is that no **new** order is created.

## 2. What the last losing run actually was

The last twelve closed trades were all **XAUUSD short**, entered between 4357 and
4366 — the same idea, over and over, within minutes. Several came from the same
setup twice (two orders on one signal). So it was not twelve independent losses;
it was one wrong view repeated, which is exactly what you suspected.

## 3. The new rule: cancel look-alike orders that have not filled

When your losing-run pause fires, P-Trades will also clear the resting orders that
are the same bet as the losses that caused it.

How it decides, in plain terms:

- It looks at the closed losses that triggered the pause and takes the instrument
  and direction they share (e.g. Gold, short).
- Any of your orders on that same instrument and direction that is **still
  unfilled** is cancelled at the broker.
- Anything filled, partly filled, or already a position is untouched — that is
  yours to manage at your broker.
- A cancellation only counts once the broker confirms it. If the broker cannot be
  read or refuses, the order is left exactly as it is and re-tried next pass, and
  the app says so rather than claiming it was cancelled.
- While the pause lasts, no new order on any instrument is created anyway, so
  nothing re-appears behind the cancel.

You will see this on the pause notice: "3 unfilled Gold short orders cancelled",
with anything the broker would not confirm listed separately.

### Your choice over it

One new setting next to the losing-run limit, in Settings → Automatic order rules:

- **Cancel matching unfilled orders when the pause starts** — on or off.
  Default off for existing accounts, so nothing changes for anyone silently.

## 4. Also fixing: the same setup queued twice

The evidence shows single setups producing two orders that both filled and both
lost. That doubles the loss for one idea. **This fix is independent of the pause** —
it applies on every enqueue, not just when a losing run is hit. The existing duplicate
check only looked at already-resting orders; the update also covers orders that are
still `pending` or `claimed`, so one signal can only ever create one live order.


## What does not change

- No change to how positions close, to stop/target placement, or to live-trading
  gates.
- Broker facts only: losses come from closed broker deals, cancellations from
  confirmed broker responses. Nothing is assumed.
- All other order checks (spread, slippage, exposure, news, order window, targets)
  stay as they are.

## Technical notes

- New `scanner_settings` column `cancel_matching_on_pause boolean not null default false`,
  with validation in the settings save path and the MCP settings validator.
- New pure module `src/lib/risk/pause-cancel.ts`: given the triggering closed
  losses and the account's open deliveries, returns the set of delivery ids whose
  `(instrument, direction)` matches and whose state is unfilled
  (`pending`, `claimed`, `sent`, `acknowledged`, `unknown` with no fill evidence).
  Fail-closed: unknown direction/instrument on either side is never a match.
- `src/lib/risk/brakes.server.ts`: when it persists a newly-started
  `consecutive_loss_limit` pause (transition only, not on every re-evaluation),
  and the setting is on, it hands the match set to the existing cancellation path.
- Reuse `expire-unfilled.server.ts` cancellation semantics rather than duplicating
  them: unsubmitted rows settle `expired` directly; submitted rows go through
  `cancelOrder` and settle only on a confirmed cancel, with reason
  `cancelled_by_losing_run`. Bounded per pass, same as the sweeper.
- `RiskHoldBanner.tsx` gains a cancelled/unconfirmed count read from the persisted
  pause state; `AutoOrderDecisions.tsx` unchanged.
- Duplicate check: `direct-enqueue.server.ts` includes `pending`/`claimed`
  deliveries in the resting-order set passed to `findDuplicateOrder`.
- Tests: pure match/no-match/fail-closed cases in
  `src/lib/risk/__tests__/pause-cancel.test.ts`; queued-duplicate case in
  `src/lib/delivery/__tests__/duplicate-orders.test.ts`.
- Docs: `docs/EXECUTION-QUALITY.md` and `docs/RISK-GUARDIAN.md` updated, covered by
  the docs-contract test.
