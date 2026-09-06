# Is the intelligence gate working — and is it helping?

## What I checked in the live data

- Your gate is on: minimum win-if-filled 53%, minimum samples 40, unmeasured setups refused.
- It is actively refusing orders: 3,479 refusals for "not enough samples" and 1,569 for
  "below your threshold", the most recent on 4 Sep. So mechanically it works exactly as
  written — it only ever removes orders, never adds one.
- Of 94 measured regime rows, only 6 have 40 or more resolved samples. Every finer
  breakdown (instrument + direction + session + volatility) is still far below 40, so most
  setups are refused for missing measurement rather than for being judged poor.
- At 53% only two cohorts currently clear the bar: EURUSD long (60.1%) and GBPAUD short
  (53.7%). EURUSD short (51.5%), XAUUSD short (52.9%) and XAUUSD long (48.3%) are blocked.

## The uncomfortable part: it is not yet shown to help

Comparing the gate's own measure against what the broker actually paid on closed trades:

| Cohort | Gate rate | Gate verdict | Real closed trades | Real wins | Real net |
| --- | --- | --- | --- | --- | --- |
| XAUUSD long | 48.3% | refuse | 12 | 10 | +7,072.65 |
| EURUSD long | 60.1% | allow | 30 | 16 | +3,939.25 |
| EURUSD short | 51.5% | refuse | 17 | 8 | +622.11 |
| XAUUSD short | 52.9% | refuse | 15 | 7 | -448.76 |
| GBPAUD short | 53.7% | allow | 18 | 3 | -3,254.20 |

The two cohorts the gate would allow include the worst money-loser (GBPAUD short), and the
single best money-maker (XAUUSD long) is one the gate refuses. Sample sizes are small, so
this is not proof the gate is harmful — but it is clear evidence that a win-rate-only
threshold is not tracking profitability, because it ignores how much is won or lost per
trade. So: working as designed, yes. Making you more profitable, not demonstrated.

## What I propose to change

1. **Judge cohorts on money, not just hit rate.** Add expected R per setup (the full payoff
   distribution already computed for the payoff panel) as the gate's primary measure, with
   win-if-filled shown alongside as context. A cohort passes only when its expected R is
   above your floor and its interval does not sit below zero.
2. **Keep the honesty rule.** Unmeasured stays refused by default; nothing thin is ever
   treated as passing, and no number is invented.
3. **Show the gate's own record.** A new owner-only Admin panel listing, per cohort: the
   gate verdict, the replay rate behind it, and the broker-verified closed trades and net
   money for the same cohort — so the gate can be judged on outcomes instead of trusted.
4. **Explain the trade-off in Settings.** Plain wording that at 53%/40 samples the gate
   currently allows only two cohorts and blocks the rest for lack of measurement, so you can
   see the cost of the setting you chose before leaving it on.

## Technical notes

- Gate math stays in `src/lib/delivery/intel-gate.ts` (pure, reduce-only) and keeps its
  single call site in `direct-enqueue.server.ts` after eligibility. No scanner, grading,
  feed, alert or live-exit behaviour changes.
- Expected R is read through the existing payoff helpers (`payoff_stats` /
  `perPlanR`) with the same tier fallback `lookupRegime` uses; unreadable statistics keep
  failing closed for the gate.
- New Admin panel reads through the owner-gated admin server function, joining
  `regime_stats` to closed `broker_trade_evidence` by instrument and direction; mixed
  currencies stay unsummed, as in the existing totals panel.
- Tests: expected-R gate refusals and pass cases, unmeasured-refusal preserved,
  reduce-only invariant, and the panel added to the mounted-panel documentation contract.
