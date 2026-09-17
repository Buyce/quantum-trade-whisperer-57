# Per-cohort automatic-trade permissions (pair + direction)

Today a user picks which instruments they see and trade. Direction is not part of that
choice, so a pair whose short side has been losing money still produces automatic orders
on both sides. This adds a per-cohort rule: for each pair-and-direction combination
(EURUSD long, EURUSD short, GBPAUD short, XAUUSD short, ...) the user decides whether
automatic orders are allowed, blocked, or allowed with a reduced share of their normal
risk.

Scope: automatic orders only. It never changes what the scanner publishes, what the feed
shows, grading, replay, learning or any statistic — exactly like the existing gates, this
rule can only refuse or shrink an order, never create or enlarge one.

## What the user gets

A new "Which bets may trade automatically" block in Settings, under the automatic-order
rules. One row per pair and direction the user has selected as an instrument, each with:

- Allow / Reduce / Block choice.
- When Reduce is chosen: a share of their normal per-trade risk (25%, 50%, 75%).
- The measured evidence for that cohort shown inline, from the same read-only source the
  Intelligence Gate table already uses: expected R per plan with its range, plans, win
  if filled, and broker win/loss and net. Labelled as measurement of what happened, not a
  forecast.

Defaults: every cohort Allow, so nothing changes for existing users until they choose.

Blocking a whole pair stays possible through the existing instrument selection; this block
is for the finer "long only on this pair" decision.

## Behaviour

- Blocked cohort: no automatic order is created. The refusal is recorded as a normal
  decision with its own reason, so it shows up in the automatic-order decision log and the
  assistant can explain it.
- Reduced cohort: the order is still created, but sized from the reduced risk percent. The
  order's record notes that the size came from a user cohort rule, so the trade log is
  honest about why it is smaller.
- Manual actions, the feed and alerts are untouched.

## Technical notes

- New table `public.auto_cohort_policies` (user_id, instrument, direction, policy
  'allow' | 'reduce' | 'block', risk_share_percent, updated_at), unique on
  (user_id, instrument, direction). Grants for authenticated and service_role, RLS scoped
  to `auth.uid()`. Additive migration only.
- Pure decision helper `src/lib/delivery/cohort-policy.ts`: given the policy rows and a
  signal's instrument/direction, return allow/block plus an optional risk-percent factor.
  Unit-tested, no Supabase.
- `src/lib/delivery/direct-enqueue.server.ts`: load the caller's policy rows alongside
  `scanner_settings`, apply the helper in the reduce-only gate chain (before the
  intelligence gate). Blocked -> `recordEnqueueDecisions` with reason
  `cohort_blocked_by_user`. Reduced -> pass the scaled percent through the existing
  `riskPercent` override that `src/lib/sizing/service.server.ts` already accepts, and store
  the reason on the decision/delivery row. Missing rows mean allow, so an unreadable policy
  set can never block or resize.
- Settings UI: extend `src/routes/_authenticated/settings.tsx` with the new block, reusing
  the cohort evidence query behind `src/components/IntelGateCohorts.tsx`; save through a
  new owner-scoped server function in a `*.functions.ts` module.
- Assistant/MCP: add the cohort policies to `get_my_settings` output and let
  `update_my_settings` change them, treated as a sensitive risk field so
  `confirm_risk_change: true` is required, with a warning whenever a cohort is moved from
  Block/Reduce towards Allow.
- Docs: update `docs/RISK-GUARDIAN.md`, `docs/MCP.md` and the automatic-order sections in
  `docs/PRODUCT.md` plus the Settings/Guide copy; bump the MCP version note.
- Tests: cohort-policy helper cases, a direct-enqueue case for block and for reduce, and a
  settings round-trip case.
