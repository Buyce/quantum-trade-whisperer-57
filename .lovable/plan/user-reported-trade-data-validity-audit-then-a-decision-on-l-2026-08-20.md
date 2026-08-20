# User-reported trade data: validity audit, then a decision on learning from it

Short answer: yes, the reported outcomes can be checked — and when I check them against the replay engine and the signal's own geometry, most of them do not survive. As they stand today they are not fit to train the model. They are useful as behaviour/discipline data, and they can become trainable if the logging captures real prices.

## What the live rows actually show

All 25 `taken` rows belong to a single account. 19 are resolved (9 win / 10 loss), 6 still open. Verified problems:

1. **Every reported R is a preset value.** Only -1.00, 1.00, 2.00 appear. No real broker fill produces exactly those values 19 times in a row — these are button presses, not measured outcomes.
2. **Six of the nine reported wins are on setups the replay engine never filled.** Examples: EURUSD 14 Aug (miss 1.63 ATR), XAUUSD 17 Aug (0.54 ATR), GBPAUD 19 Aug x2, XAUUSD 19 Aug (2.05 ATR), EURUSD 19 Aug. Price never reached the published limit entry, so a win at that entry is not reproducible. This is the entire reason 47.4% sits above the replay's 21.4%.
3. **At least one reported R exceeds the setup's own maximum.** EURUSD 19 Aug 11:30 has `max_r` 1.21 (TP2 = 1.21) yet is logged as +2.00 R. Not reachable on that structure.
4. **Several outcomes were logged 2-3 seconds after the decision row was created** (19 Aug 05:28, 19 Aug 11:08, 20 Aug 01:14 x2) — retroactive batch marking, not live tracking.
5. **Direction sanity holds** (no long/short mismatches), and the loss rows agree with the replay: where replay filled and lost, the user also logged -1.00.

So the losses look honest; the wins are the unreliable half, and they are the half inflating the tile.

## Can we learn their execution method from this?

Not from these fields. `executed_trades` stores only outcome + an R preset — no entry price, no exit price, no timestamps of entry/exit, no partials. That cannot distinguish "entered early at market", "moved stop to breakeven", "closed at TP1 manually". With n=19 from one account it also has no statistical power. Feeding it into the Bayesian regime engine would poison labels that are currently deterministic and reproducible.

What is genuinely learnable today, from behaviour rather than outcomes: which grades/sessions/instruments this account chooses to take versus skip, and how its choices score under replay — which is exactly what the discipline index measures.

## Proposed work

### 1. Validation layer (server-side, aggregate + per-row flags)

New server function `src/lib/user-audit.functions.ts` (owner-gated, same pattern as `admin.functions.ts`), joining `executed_trades` -> `scanned_signals` -> `shadow_executions` and emitting per-trade flags:

- `never_filled_in_replay` — win reported on a setup price never reached
- `r_exceeds_max_r` — reported R above the setup's structural maximum
- `preset_r_value` — R is exactly ±1 / 2 (unverifiable magnitude)
- `logged_within_60s` — outcome stamped seconds after the decision
- `direction_mismatch`, `outcome_disagrees_with_replay` (informational, not necessarily wrong)

Plus a rollup: verified / unverifiable / contradicted counts and a "trust score".

### 2. Admin panel section

New "User-reported data integrity" panel under the existing tiles on `/admin/intelligence`: rollup counts, trust score, and a table of the flagged rows with the reason. The `User-reported win rate` tile gains a sub-line showing the win rate restricted to non-contradicted rows, plus a hint that the raw figure includes unverifiable entries.

### 3. Make future user data trainable (logging change)

In Trade History's expand-to-edit, replace the R preset with two optional numeric fields — **actual entry price** and **actual exit price** — and derive R server-side from the signal's own risk distance. Outcome stays required; prices stay optional so nothing breaks for users who don't fill them. Requires two nullable columns on `executed_trades` (`actual_entry_price`, `actual_exit_price`) and a stored `derived_r`.

Once prices are present, the audit can verify each trade against the candle series, and the execution style (early entry, partial close, breakeven exit) becomes measurable per user.

### 4. Learning engine: unchanged

The regime engine keeps training only on deterministic shadow replay labels. User-reported outcomes stay observational until a validated sample exists (proposal: >= 100 price-verified trades across >= 5 accounts before it is even considered as a secondary label). No change to grading, alerts, or priors in this plan.

## Technical notes

- Read-only additions plus one small schema migration (2 nullable price columns + `derived_r`); `get_admin_intelligence()` is untouched, the audit is its own owner-gated function so the 3s admin RPC budget is unaffected.
- Zero-hallucination preserved: every flag is derived from live rows; zero flagged rows renders as "no integrity issues found", never as filler.
- Files: new `src/lib/user-audit.functions.ts`, new panel in `src/components/admin/AdminPanels.tsx`, wiring in `src/routes/_authenticated/admin/intelligence.tsx`, edit form in `src/routes/_authenticated/history.tsx`, mutation in `src/lib/queries.ts`.

## Is it beneficial?

Yes, in this order: the audit is immediately valuable (it explains and contains the 47.4% figure and stops a bad number driving decisions); the logging change is valuable within weeks (it turns opinions into measurable executions); training on user data is only worth doing after that, and only with real prices behind it.
