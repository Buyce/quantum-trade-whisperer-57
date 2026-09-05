# Execution Safety and Edge — Audit of the Eight Proposals, Then Build

## Two things found during the audit that you should know first

**1. The live switches are already ON.** The control row currently reads
`live_execution_enabled = true`, `live_auto_enabled = true`, `force_dry_run = false`.
Nothing live is actually happening, because no real broker account exists or is
armed — the 2 accounts on automatic are both broker-confirmed demo. So the outer
door is open and only the inner per-account gate is holding. I had previously told
you live was off; that was wrong as of today.

**2. Yesterday is the case for brake #1.** Closed broker trades by day:

```text
2026-09-04   21 trades   -5,424.02
2026-08-27   16 trades   -3,203.60
2026-09-01   16 trades   -1,965.34
2026-09-02   24 trades     +800.93
2026-09-03   36 trades  +13,479.89
```

Nothing stopped the -5,424 day at trade 5 or 10. There is no daily-loss brake.

## Scorecard: how many of the eight exist

| # | Proposal | Status |
|---|---|---|
| 5 | Signal edge separated from execution edge | **Done** |
| 1 | Broker-derived drawdown brakes | **Partial** — broker-side trackers exist, wired to nothing, 0 rows |
| 3 | Rank trades before spending slots | **Partial** — ranker built, never switched on |
| 6 | Test smarter exits in shadow first | **Partial** — stops only, no partials/runners/trailing |
| 2 | Score execution quality per broker/account/instrument | **Not built** |
| 4 | Adaptive spread/slippage limits | **Not built** — static, user-typed |
| 7 | Walk-forward validation | **Not built** — sample floors + intervals only |
| 8 | Automatic cooldowns from broker evidence | **Not built** |

One fully done, three half-done, four not started. Every proposal is sound and
none of them contradicts the existing design.

### What the "partials" actually are

- **#1**: broker-side risk trackers (daily and monthly drawdown) can be created on
  your MetaApi account, and breach events have a table. Both tables hold **0 rows**,
  and no execution gate reads them. The code comment claims breaches "may influence
  execution" — nothing implements that. The only stop today is your manual button.
- **#3**: the cap sequence accepts an evidence ranker; there is no call site that
  passes one. Slot order today is pure first-come-first-served.
- **#6**: replay simulates one exit at the first target only. Stop-tightening can be
  measured. Break-even and trailing are correctly reported as un-measurable from the
  stored data, because two summary numbers cannot say which happened first.

### Where #7 matters most

Cohort and gate decisions today are judged on sample floors and confidence
intervals over the *same* period they were learned from. That is a defensible bar,
but it is not out-of-sample. Every loosening decision the platform can make is
currently vulnerable to fitting the past.

## Build order

Ordered by loss prevented per unit of work.

### Phase 1 — Drawdown brakes (proposal 1)
Own the brake in P-Trades rather than relying on the broker's tracker.

- New `account_risk_state` per account, recomputed from **closed broker evidence
  only**: realised P&L for the UTC day, the ISO week, consecutive losing trades, and
  peak-to-current equity drawdown using `broker_equity` observations.
- New user limits: daily loss %, weekly loss %, consecutive losses, max drawdown %.
  Safe defaults for new accounts; existing accounts default to off so nothing
  changes under you without consent.
- A breach sets the account to a **paused** state with a reason and an automatic
  resume boundary (next UTC day / next ISO week / manual for drawdown). Pausing
  stops *new* orders only; orders already at the broker are never touched, and the
  UI says so.
- Enforced at automatic enqueue **and** again immediately before submission.
- If equity or evidence cannot be read, the brake **refuses rather than assumes
  safety** — an unreadable account is not a healthy one.
- Also finish the broker-side tracker sync so the broker's own limits back it up.

### Phase 2 — Execution-quality scoring and automatic cooldowns (2 and 8)
These are one job: the score is what the cooldown reads.

- Rolling per `(account, instrument, session)` score from closed broker evidence:
  fill rate, median and tail slippage, reject/refusal rate, margin refusals,
  order-to-acknowledgement latency, and realised R after fill.
- Every field is broker-derived or delivery-ledger-derived. A dimension without
  enough closed trades reads **"not measured"** and never triggers anything.
- Cooldown: a dimension whose slippage or reject rate is materially worse than its
  own established norm is paused for a bounded window, then re-tested with reduced
  size before returning to full size.
- Surfaced in Admin → Intelligence so you can see which broker, symbol and session
  actually executes well.

### Phase 3 — Adaptive spread and slippage norms (proposal 4)
- Learn the normal entry spread per `(instrument, session, account, volatility
  bucket)` from observed quotes and fills, and express the ceiling as a multiple of
  that norm.
- Your typed absolute limits stay, and stay authoritative as a hard cap: the learned
  norm can only ever tighten, never loosen past what you set.
- No norm yet for a bucket ⇒ the typed limit alone applies. Never invented.

### Phase 4 — Expected-value slot ranking (proposal 3)
- Turn on the existing ranker with an expected-R score per cohort:
  `P(fill) x P(win | filled) x average win R  -  P(loss | filled) x average loss R`,
  shrunk toward the parent cohort, with the same cluster-robust interval bar already
  used elsewhere.
- Only cohorts that clear the evidence bar get a score; unmeasured setups keep their
  chronological position and can never be outranked out of existence.
- Feed and alert ordering stay chronological — this changes which orders spend a
  scarce slot, not what you see.

### Phase 5 — Walk-forward validation (proposal 7)
- Split every learning decision by time: fit on an earlier window, judge on a later
  held-out window, rolling forward.
- A gate may only loosen when the held-out window agrees, and the change is reverted
  automatically if the post-change cohort disagrees.
- Applies to cohort gating, filter lift and the threshold proposals.

### Phase 6 — Smarter exits, shadow only (proposal 6)
- Requires bar-level replay to be extended to record the post-entry path, not two
  summary numbers. Without that, partial exits, runners and trailing stops cannot be
  honestly simulated and will keep returning "not decidable".
- Then simulate: partial at first target with runner, break-even after a threshold,
  and trailing variants, each against the current single-exit policy on out-of-sample
  data.
- Live exit policy stays `single_exit_first_target` until a variant wins out-of-sample.

## Rules kept throughout

- No fabricated, seeded or fallback trading data anywhere.
- Every brake, score and cooldown is broker-derived; unmeasured means unmeasured.
- All new gates are reduce-only: they can refuse an order, never authorise one.
- Advisory numbers never imply broker state.
- Demo first. Live stays gated behind a broker-confirmed real account, deliberate
  arming and fresh confirmation.
- Broker-held orders are never silently cancelled by a brake.

## Technical notes

New tables: `account_risk_state`, `account_risk_limits` (or columns on
`scanner_settings`), `execution_quality_scores`, `execution_cooldowns`,
`spread_norms`. All with grants and owner-scoped RLS.

Enforcement points: `src/lib/delivery/direct-enqueue.server.ts` (pre-enqueue) and
`src/lib/delivery/revalidate.server.ts` (pre-send), plus new refusal reasons in
`src/lib/delivery/execution.ts` and wording in `enqueue-log.ts`.

Scoring and norms recomputed by a bounded cron worker off closed
`broker_trade_evidence` and `execution_deliveries`, never on request paths.

Ranking uses the existing `CapRanker` seam in `src/lib/delivery/eligibility.ts`.

Walk-forward lives beside `src/lib/stats/bootstrap.ts` and feeds
`src/lib/learning/readiness.ts`, `filter-lift.ts` and `cohort.ts`.
