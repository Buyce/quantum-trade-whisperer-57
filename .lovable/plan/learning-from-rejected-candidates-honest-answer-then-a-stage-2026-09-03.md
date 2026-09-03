# Learning from rejected candidates — honest answer, then a staged plan

## What those monitors actually are (answering your follow-up)

Everything you screenshotted is **measurement**, not learning. The distinction:

- **Shadow replay** — replays setups against stored candles to produce outcomes
  (win/loss/R). It creates *data*. It never changes a grade.
- **Replay-Rate Learning Monitor / regime stats** — aggregates those outcomes
  into P(win), fill rates, regime breakdowns. It *describes* the data. The
  "learning" in the name means "learning about the system," not the system
  learning.
- **Grade Calibration** — checks whether grades deserve their labels
  (does A beat B beat C?). A report card, not a correction.
- **Filter lift** — compares published vs rejected arms per gate. Explicitly
  measurement-only; it changes no threshold.

So the pipeline today is: replay → statistics → panels. The last step,
"evidence changes the rules," does not exist. No weights are fitted, no grade
or threshold has ever been altered by this data, and nothing feeds back into
the scanner. That missing step is what you're asking to build.

## Your screenshots say the loop matters *now*

Two findings visible in your own panels justify prioritising this:

1. **Grade inversion.** Calibration shows A: 7 samples, 33.3% WR, −0.14R;
   B: 597 samples, 54.3% WR, +0.03R; C: 375 samples, 45.8% WR, −0.00R.
   A is statistically thin (n=7) but currently *worse than B*. The A label is
   not earning its premium — exactly the kind of mispricing a closed learning
   loop should catch.
2. **Discipline index inversion.** Taken: 33.3% WR, −0.31R. Skipped: 75.0% WR,
   +0.50R — skipped setups won 41.7pp more often. Small n (31/16), replay-only,
   not broker fills — but if it holds as samples mature, the current gates are
   filtering *against* profit.

These are early, replay-derived, and under the 30-sample floor, so no action
yet — but they are precisely what the plan below turns into evidence.

## Plan — Stage 1: close the measurement loop (build now)

1. Learning evidence surface
   - Extend Filter Lift from "is it decidable" to a decision record per gate:
     PASS vs FAIL mean R with intervals, counts, replay coverage, verdict, and
     what is still missing.
   - Per-slice breakdown (instrument, session, grade family) with the same
     30-sample floor per slice; thin slices say "not yet decidable", never a
     rounded-up number.

2. Proposal ledger (no auto-apply)
   - New table for gate-change proposals: gate, current value, proposed value,
     frozen supporting stats (`as_of`), verdict, status
     (proposed / approved / rejected / reverted), approver, reason.
   - A proposal may only be created when the gate is decidable and the
     direction is `loosening_supported` or `gate_supported`.
   - Owner-only approval, applied through the existing audited change path.
     Nothing changes automatically, ever.

3. Post-change verification
   - A threshold change records its change point and reports the following
     cohort separately, so a loosening that degrades results is visible and
     revertible from the same panel.

4. Guardrails preserved
   - Replay-only outcomes stay labelled replay-only; candidates never enter
     feed, journal, Performance, or execution.
   - 5-day / 200-sample instrument promotion gate untouched.
   - No seeded or synthetic rows.

## Stage 2 (later, gated on data): calibrated scoring

Only when every gate arm has 200+ matured samples and 20+ trading days:

- Fit a transparent low-capacity model (logistic on existing pillar/context
  features) offline against replay outcomes.
- Report out-of-sample calibration and cluster-bootstrap intervals,
  walk-forward by time.
- Ship first as a *shadow score* beside the rule grade; it must demonstrate
  lift in shadow before influencing any published grade. The rule table stays
  authoritative until proven.

## Technical notes

- Reuse `recompute_filter_lift(24)` / `filter_lift_stats`; add slice columns
  rather than a parallel statistics path.
- Proposal approval reuses the existing service-role-only promotion pattern.
- New RPCs follow the admin-only, security-definer, paged shape of
  `get_admin_candidate_lineage`.
- Grade-inversion and discipline-inversion findings get explicit rows in the
  evidence surface with their sample sizes, so they mature into a verdict
  instead of sitting as a static warning.
