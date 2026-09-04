# Staged live rollout, per-trade confirmation, and the webhook bridge

Three stages, each independently reversible. Nothing goes live until the stage before it has produced evidence.

## Current verified state

- `execution_controls`: `live_execution_enabled = false`, `live_auto_enabled = false`, `demo_auto_enabled = true`, `force_dry_run = false`, `allowed_live_hosts = []`.
- Live arming, pre-send revalidation, HMAC-v2 signing, SSRF host validation, broker preflight and evidence settlement already exist and already refuse live work while the gates are off.
- Two real blockers: enabling live execution currently requires a non-empty host allow-list even for the direct MetaApi path (which has no host), and `live_confirm` is inert — nothing enqueues it and there is no confirm surface.
- Live account quota is 1 per user (`account_quota_defaults.max_live = 1`).

## Stage 1 — Open the live gates safely (Admin only)

1. Split the enable rule in `setExecutionSwitches` (`src/lib/admin.functions.ts`): the non-empty allow-list requirement applies to the **webhook bridge destination only**. Direct MetaApi live execution may be enabled with an empty list, because the destination is the broker through MetaApi and authorisation comes from the armed account plus the global gates. Bridge deliveries keep failing closed on an empty list, as they do today (`revalidate.server.ts:861`).
2. Add explicit live-rollout guardrails to `execution_controls`, enforced in revalidation, not just in the UI:
   - `live_max_orders_per_utc_day` (global ceiling across all live accounts, default small, e.g. 3)
   - `live_max_risk_percent` (hard ceiling that overrides a user's risk setting for live destinations)
   - `live_kill_switch_reason` — set by one click; while non-null every live delivery is rejected with an audited reason and demo/dry-run keeps working.
3. Every change already writes `execution_control_changes`; extend the audit rows to record the new keys.
4. Enablement order the operator follows in Admin → Execution: add your bridge host (Stage 3) or leave empty for direct → turn on **Real-money execution** → arm one real account in **Live on confirmation** → only after confirmed fills, turn on **Automatic real-money orders**.

## Stage 2 — Per-trade confirmation panel (makes `live_confirm` real)

Today a `live_confirm` account is skipped by `direct-enqueue.server.ts` (it only matches `demo_auto` / `live_auto`), so it can never produce an order.

1. New delivery state `awaiting_confirmation`, inserted between `pending` and `claimed`:
   - not claimable by the dispatcher, not terminal, does not occupy a fill slot until confirmed;
   - expires automatically when the setup's automatic-order window or TIF passes, with reason `confirmation_window_expired`.
2. Enqueue: allow `live_confirm` + real account when `live_execution_enabled` is on, running the **same** eligibility chain as automatic orders (instruments, sessions, grade threshold, UTC-day cap, market-open, duplicate-per-setup, decision row). The only difference is the resulting row is `awaiting_confirmation`, never `pending`.
3. Two owner-authenticated server functions in a new `src/lib/delivery/confirm.functions.ts`:
   - `confirmLiveDelivery` — requires the caller to own the delivery, re-reads the setup, and moves the row to `pending` with a stored confirmation identity (user, timestamp, config version, the exact plan shown). Full pre-send revalidation still runs at dispatch; confirmation is authorisation, not a bypass.
   - `declineLiveDelivery` — terminal `rejected` with reason `declined_by_owner`.
4. New **Live order queue** panel on `/history` (and a badge in the terminal header): each awaiting row shows instrument, direction, grade, entry / stop / first target, computed lot size and cash at risk, margin (labelled estimate), the countdown to expiry, and Confirm / Decline. After confirmation the same row tracks `sent → acknowledged → filled / resting at broker — not filled / expired`, driven by existing broker evidence and the active reconciler — no new fill claims are invented.
5. Confirmation is blocked, with the reason shown, whenever the kill switch is set, the market is closed, the setup is stale, or the live daily ceiling is reached.

## Stage 3 — External webhook bridge, then allow-list it

Purpose: reach a trader/terminal that is not driven through MetaApi directly.

1. Public receiver-side contract documented in `docs/EXECUTION.md`: HMAC-SHA256 v2 signature header, timestamp + delivery-id replay protection, the `single_exit_first_target` JSON body already produced by `buildBridgeOrder`, and required `200` acknowledgement semantics ("sent is not acceptance").
2. Reference receiver shipped as a documented example plus a self-test route under `src/routes/api/public/` that verifies a signature and echoes the parsed order, so a trader can validate their endpoint before any live order exists. It performs no trading and stores nothing.
3. Settings gains a bridge preflight: send a signed test request, show status, and record `webhook_validated_at`; a live bridge order stays dry-run until the endpoint has passed preflight for the current config version (that rule already exists).
4. Only then add the bridge host to `allowed_live_hosts` in Admin. Host validation, DoH SSRF resolution, no-redirect and single-attempt behaviour are unchanged.

## What stays untouched

Scanner publication, grading, research/shadow statistics and every "no fabricated data" rule. No seeded or example signals, deliveries or fills. Live execution remains OFF until you flip it, and the kill switch reverts everything to demo/dry-run without a deploy.

**Your demo auto-trader keeps running, unchanged.** `demo_auto_enabled` stays on and every check it passes today still passes: the new live caps and kill switch gate only real-account (`live_auto` / `live_confirm`) and live-bridge destinations, and the new `awaiting_confirmation` state only ever exists for `live_confirm` accounts — demo rows never take that path.

## Technical notes

- Migrations: new `execution_controls` columns (live caps, kill switch), the `awaiting_confirmation` state plus confirmation-identity columns on `execution_deliveries`, and a small change to `claim_execution_delivery` so it still claims only `pending`.
- Code: `admin.functions.ts`, `delivery/execution.ts` (state vocabulary), `direct-enqueue.server.ts`, `revalidate.server.ts` (caps + kill switch), new `confirm.functions.ts`, new `LiveOrderQueue.tsx`, `ExecutionSwitchPanel.tsx`, `settings.tsx`, `docs/EXECUTION.md`, `docs/BROKER-ACCOUNTS.md`.
- Tests: confirmation state machine, expiry, ownership, kill-switch and cap enforcement, enqueue mode matrix, bridge signature verification.

## Needed from you

- The bridge hostname (Stage 3) — only when you have one; Stages 1–2 do not need it.
- Your intended live risk ceiling (percent per trade) and live orders per day for the initial caps.
