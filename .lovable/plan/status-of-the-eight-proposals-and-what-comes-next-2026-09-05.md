# Status of the Eight Proposals — and what comes next

## Direct answer

No. Only the first of the six phases is built and operational. Here is the exact
state of all eight proposals, verified against the code and database today:

| # | Proposal | Status |
|---|----------|--------|
| 5 | Signal edge separated from execution edge | **Done and operational** — built earlier |
| 1 | Broker-derived drawdown brakes | **Done and operational** — Phase 1, completed this session |
| 3 | Rank trades before spending slots | **Partial** — ranker seam (`CapRanker`) and cohort scoring exist, but no enqueue call site passes a ranker; daily slots are still first-come-first-served |
| 6 | Smarter exits in shadow first | **Partial** — research-only counterfactual stop harness (tighter stops 0.4–0.8) exists in Admin Intelligence; partial exits, runners, trailing not measurable from current replay data |
| 2 | Execution-quality scoring per broker/account/instrument | **Not built** — no `execution_quality_scores` table or scoring code anywhere |
| 8 | Automatic cooldowns from broker evidence | **Not built** — no `execution_cooldowns` table; only retry backoff exists |
| 4 | Adaptive spread/slippage limits | **Not built** — no `spread_norms` table; limits are static and owner-typed |
| 7 | Walk-forward validation | **Not built** — sample floors and confidence intervals only, no time-split holdout |

So: 2 fully done, 2 half-done, 4 not started.

## What Phase 1 (drawdown brakes) gives you today

- New owner limits in Settings: daily loss %, weekly loss %, consecutive losses,
  equity drawdown from peak. Off by default; existing users opt in.
- Measured from closed broker trades and broker-reported equity only — never
  journal guesses or inferred balances.
- Enforced at automatic enqueue AND again immediately before submission.
- A breach pauses the account with a reason and an automatic resume boundary
  (next UTC day / next ISO week / manual). Orders already at the broker are
  never touched.
- If the broker evidence or equity cannot be read, the brake refuses new orders
  rather than assuming safety.
- Tests pass; full suite 1543 green, build OK.

## Remaining work, in planned order

- **Phase 2 — Execution-quality scoring + automatic cooldowns (proposals 2, 8).**
  Rolling per (account, instrument, session) scores from closed broker evidence:
  fill rate, slippage, reject rate, margin refusals, latency, realised R.
  Dimensions with too little data read "not measured". Dimensions materially
  worse than their own norm get paused for a bounded window, then re-tested at
  reduced size.
- **Phase 3 — Adaptive spread/slippage norms (proposal 4).** Learn normal spread
  per (instrument, session, account, volatility bucket); the learned norm can
  only tighten the owner's hard cap, never loosen it.
- **Phase 4 — Evidence-ranked slot spending (proposal 3).** Switch on the
  existing ranker with shrunk expected-R per cohort; unmeasured setups keep
  chronological position.
- **Phase 5 — Walk-forward validation (proposal 7).** Fit on an earlier window,
  judge on a held-out later window; gates loosen only when the holdout agrees,
  auto-revert if the post-change cohort disagrees.
- **Phase 6 — Smarter exits, shadow only (proposal 6).** Requires extending
  replay to record the post-entry price path; until then partials/runners/
  trailing honestly return "not decidable".

## Rules kept throughout

- No fabricated, seeded or fallback trading data anywhere.
- Unmeasured means unmeasured — never zero, never assumed safe.
- All new gates are reduce-only: they can refuse an order, never authorise one.
- Broker-held orders are never silently cancelled.

## Suggested next step

Approve to proceed with **Phase 2 (execution-quality scoring + automatic
cooldowns)** — it is the next-highest loss-prevention item and builds directly
on the broker-evidence infrastructure Phase 1 now uses.
