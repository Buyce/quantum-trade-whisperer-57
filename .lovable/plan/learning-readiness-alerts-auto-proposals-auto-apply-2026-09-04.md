# Learning readiness: alerts, auto-proposals, auto-apply

## Answering your questions first

**What is a learning proposal?** It is a record saying "the evidence now supports changing one numeric gate from X to Y", with the supporting statistics frozen into it. Today only three gates are tunable: risk ceiling, headroom, reachable R. A proposal stores the current value, the proposed value, the frozen pass/fail statistics, and a verdict (`gate_supported` = keep/tighten, `loosening_supported` = the gate is filtering out profit).

**Does the system propose one automatically today?** No. Today a proposal can only be created by you, through the panel form, and the database refuses it unless both arms are already decidable (30+ matured samples each, non-overlapping 95% intervals). So the evidence bar is automatic; the act of proposing is manual. This plan makes the proposing automatic too.

**Is the model ready now?** No. Audited live: 0 matured research-cohort outcomes (390 still resolving, 178 outside the replay window), production matured samples A: 3 / B: 167 / C: 131 across 17 trading days, and `filter_lift_stats` currently holds no qualifying rows. Nothing can be proposed or trained yet.

## What gets built

### 1. Readiness email to the Admin
Reuse the existing once-only milestone latch (same mechanism as the fill/win milestone emails, so it can never send twice).

- New milestone gate: `model_readiness`.
- Fires the first time the evidence crosses the training bar: every tunable gate arm has >= 200 matured samples, >= 20 distinct trading days of coverage, and at least one gate is decidable.
- Email states which gates are decidable, sample counts per arm, trading days covered, and the verdict per gate. No numbers are rounded up and no gate is claimed decidable unless the database says so.
- Evaluated at the tail of the hourly recompute, guarded so an email failure can never fail the recompute (existing pattern: claim, send, release on failure).

### 2. Automatic proposals
- The hourly recompute, after `recompute_filter_lift`, asks each tunable gate whether it is decidable and has a readable verdict.
- When it does and no open proposal exists for that gate, the system inserts a proposal with `proposed_by = 'system'` and a machine-written reason naming the evidence.
- Proposed value is derived from the evidence, not invented: for `loosening_supported`, one conservative step toward the FAIL arm; for `gate_supported`, one conservative step tightening. Step sizes are fixed constants in code, capped so a single proposal can never move a gate more than a defined fraction of its current value.
- The existing "one open proposal per gate" rule is kept, so the system cannot spam proposals.
- A second email notifies you when the system opens a proposal.

### 3. Automatic application of an override
You asked for this to be automatic once requirements are met. Doing it unconditionally would let statistics move live signal delivery with no human in the loop, so it ships as an owner-controlled switch that is **off** until you turn it on:

- New control: `auto_apply_gate_changes` (owner-only, audited like the other execution controls).
- With it off (default), behaviour is exactly as today: system proposes, you approve.
- With it on, a system proposal auto-approves only when ALL hold: both arms >= 200 matured samples, >= 20 trading days, non-overlapping 95% intervals, cluster count >= 10 instrument-days per arm, and no auto-apply for the same gate within the previous 7 days.
- Every auto-apply writes the same audit trail as a manual approval (`execution_control_changes`, `applied_at`, actor `system:auto_apply`) and emails you.
- Auto-revert guard: if the post-change cohort for an auto-applied gate reaches 100 matured samples with a mean R below the pre-change arm, the override is reverted automatically and you are emailed.

## Not doing

- No new measurement panel. The existing Learning Evidence panel gains only a readiness line and a "system" badge on auto-created proposals.
- No trained ML model in this plan — the data does not support one yet. This plan builds the alerting and the automatic threshold loop; model training stays a separate future stage.

## Technical notes

- `propose_gate_change` currently hard-requires `is_admin()`. Add a service-role-only internal path (or a separate `propose_gate_change_system` function) so the cron can insert; the admin path is unchanged and the decidability checks are shared, not duplicated.
- `decide_gate_change` gains an internal auto-approve caller subject to the stricter gate above; the owner-facing signature and behaviour are untouched.
- Readiness computation lives in a pure module with tests (sample counts, trading days, decidability) so the thresholds are verifiable without hitting the database.
- New email templates registered in `src/lib/email-templates/registry.ts`; milestone latch extended to the new gates.
- Roadmap gets entries for the readiness email, auto-proposal, and auto-apply switch.
