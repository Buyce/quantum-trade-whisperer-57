# Learning from rejected candidates — honest answer, then a staged plan

## Straight answer to your question

No. There is no trained machine-learning model in P-Trades today, and nothing
in the scanner adapts its grades from enrolled candidates.

What actually exists:

- Grades come from a fixed, hand-written truth table (V2 continuation /
  mean-reversion rules: timeframe alignment, Point C band, headroom, pillars).
  No weights, no fitting, no model file.
- Enrolled candidates get replay-derived outcomes only (frozen counterfactual
  ladder over real candles). They never receive broker fills or money P/L.
- `filter_lift_stats` compares the PASS arm (what was published) against the
  FAIL arm (what was rejected) for each gate. It is explicitly
  measurement-only: it needs 30+ matured samples per arm and non-overlapping
  95% intervals before it will even call a gate "decidable", and it changes no
  threshold.

So the current state is: we can *measure* whether a rejected cohort would have
been profitable. We do not *learn* from it, and nothing feeds back into grading.

## Is training on it a good idea?

Partly yes, with hard limits — and not as a black-box model yet.

Good, and worth doing now:
- The candidate funnel is the correct data foundation. Capturing rejections
  before publication is exactly what removes selection bias, and most trading
  systems never have this.
- Gate-level lift (should this specific filter be loosened?) is answerable with
  the data we already collect, and it is auditable.

Not a good idea yet:
- Sample size. Roughly 1.3k candidates and a few hundred enrolled, spread over
  many gates, instruments, sessions and directions. A fitted classifier on that
  would mostly learn noise and instrument-specific quirks.
- Replay is not fills. Candidate outcomes have no spread/slippage/rejection
  reality. A model trained on replay R would systematically overrate rejected
  setups — the ones rejected for execution-quality reasons most of all.
- Overlapping trades. Samples are clustered by instrument and time; naive
  fitting badly overstates confidence.
- Auditability. Your zero-hallucination rule means every number must be
  traceable. A weight vector that silently changes a grade is the opposite of
  that.

Recommended path: make the measurement loop actually close (evidence →
decidable verdict → an explicit, owner-approved threshold change), and only
consider a fitted model once each gate arm has real matured volume and we can
show calibration out-of-sample.

## Plan — Stage 1: close the measurement loop (build now)

1. Learning evidence surface
   - Extend the Filter Lift panel from "is it decidable" to a decision record:
     per gate, PASS vs FAIL mean R with intervals, sample counts, replay
     coverage, verdict, and what is still missing.
   - Add per-slice breakdown (instrument, session, grade family) with the same
     30-sample floor per slice; thin slices show "not yet decidable", never a
     rounded-up number.

2. Proposal ledger (no auto-apply)
   - New table for gate-change proposals: gate, current value, proposed value,
     supporting stats snapshot (frozen `as_of`), verdict, status
     (proposed / approved / rejected / reverted), approver, reason.
   - A proposal may only be created when the gate is `decidable` and the
     direction is `loosening_supported` or `gate_supported`.
   - Owner-only approval. Approval writes the new threshold through the
     existing execution-control style change path with an audit row. Nothing
     changes automatically, ever.

3. Post-change verification
   - When a threshold changes, record the change point and report the following
     cohort separately, so a loosening that degrades results is visible and can
     be reverted from the same panel.

4. Guardrails preserved
   - Replay-only outcomes stay labelled replay-only; candidates never enter the
     user feed, journal, Performance, or execution.
   - The 5-day / 200-sample instrument promotion gate is untouched.
   - No seeded or synthetic rows anywhere in this work.

## Stage 2 (later, gated on data): calibrated scoring

Only start when every gate arm we want to score has 200+ matured samples and
at least 20 trading days of coverage:

- Fit a transparent, low-capacity model (logistic on the existing pillar and
  context features) offline against replay outcomes.
- Report out-of-sample calibration and cluster-bootstrap intervals, walk-forward
  by time.
- Ship it first as a *shadow score* shown next to the rule grade — it must
  demonstrate lift in shadow before it is allowed to influence any published
  grade. The rule table stays authoritative until that is proven.

## Technical notes

- Reuse `recompute_filter_lift(24)` and `filter_lift_stats`; add slicing columns
  rather than a parallel statistics path.
- Proposal approval reuses the existing service-role-only promotion pattern.
- New RPCs follow the admin-only, security-definer, paged shape used by
  `get_admin_candidate_lineage`.
