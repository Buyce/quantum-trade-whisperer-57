# Why the automatic-thresholds switch isn't visible, and the fix

The switch was built and connected: `LearningEvidencePanel` renders an "automatic application ON/OFF" row with a Turn on button, wired to the owner-only `setAutoApplyGateChanges` server function and the audited `set_auto_apply_gate_changes` database function.

It isn't on screen because the whole "Model readiness" block only renders when the readiness read succeeds, and that read is currently failing. `filter_lift_stats` holds 0 rows right now (confirmed), and on that path the readiness routine reaches its per-gate arms with nothing assigned, so it errors instead of returning a "no evidence yet" report. The panel has no error branch for that read, so the section — and with it the button — is simply skipped in silence.

To be precise about scope: this switch is an owner-only control, not a per-user setting. It governs whether the system may apply a threshold change itself instead of only proposing one.

## What gets changed

1. Make the readiness report tolerate an empty evidence table: with no rows for a gate, it returns that gate with null sample counts, `decidable = false`, `training_ready = false` and no verdict, instead of raising. Zero rows means "nothing matched yet" and is reported as such — no numbers are invented.
2. Always render the readiness section in the panel, including the auto-apply switch, regardless of whether evidence rows exist. When the readiness read genuinely fails, show the error text in place of the gate rows and keep the switch usable.
3. Add a test covering the empty-evidence case so the section can't disappear again.

## What stays the same

- The switch stays default OFF, owner-only, and audited on every flip.
- Turning it on changes no threshold by itself: a change still has to clear the full training bar (200 matured samples and 10 clusters per arm, 20 trading days, non-overlapping intervals). With today's zero matured research outcomes, nothing can be applied.
- No scanner, alert, or execution behaviour changes.

## Technical notes

- New migration replacing `public.gate_readiness()`: initialise per-gate arm values from a left-joined lookup rather than bare record variables, and coalesce every count/status so a missing arm yields nulls and false flags. Grants and the `is_admin()`/service-role guard are unchanged.
- `src/components/admin/LearningEvidencePanel.tsx`: move `ReadinessSection` out of the `readinessQuery.data &&` guard; pass an optional error and render `EMPTY_GATE_READINESS` as the fallback shape.
- Test in `src/lib/learning/__tests__/readiness.test.ts` for the empty-evidence render inputs; verify with typecheck plus the existing admin panel tests.
