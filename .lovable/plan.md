# Live-account readiness audit and go-live path

## Short answer

Not yet. The live-trading machinery is built, but **no customer can trade real money today**, and no real-money order has ever been placed through P-Trades. Everything the bot has proven so far is on demo.

## What the audit found (checked in the database and code today)

Built and in place:
- Live confirmation queue on Trade History, with confirm / decline actions.
- Per-account emergency stop and release on the Accounts page.
- Event-driven reconciliation, pre-send revalidation, news blackout, spread/slippage/exposure ceilings, per-instrument/direction block or reduce rules.

Switched off (by design, waiting on your decision):
- Customer live confirmation: off. Customer live auto-trading: off. Admin live-confirm mode: off.
- Because of this, a customer cannot arm a real-money account at all.

Evidence gaps:
- Zero live accounts connected (the only one is disconnected). All 14 other non-demo-auto accounts sit in Observe.
- Zero live orders ever. All 458 automatic orders and 305 broker trades are demo.
- Demo order outcomes: 56 accepted by broker, 228 expired unfilled, 164 refused, **8 with unknown broker state**, 1 pending, 1 sent. Unknown orders must be fully explained before real money — each is a possible duplicate or unprotected position.
- Admin master switches are inconsistent: live execution and live auto are ON while live confirm is OFF. Harmless now (customer gates block everything), but it would let live auto skip the per-trade confirmation stage once customers are opened.
- Grade audit showed no proven edge yet between grades; the demo record is under a month.

## Plan

1. **Settle the 8 unknown-state orders.** Reconcile each against the broker by client ID, record the true outcome, and fix any code path that left them unresolved. Go-live blocker.
2. **Explain the refusal and expiry rates.** Break the 164 refusals and 228 expiries down by reason and instrument; fix real bugs, and document the ones that are correct safety behaviour.
3. **Fix the switch ordering.** Turn admin live auto OFF so the only possible first stage is confirm-each-trade. Add a rule that live auto cannot be enabled before live confirm has run.
4. **Full live dry run on one real account (yours).** Connect one broker-confirmed real account, arm it to live-confirm, and run the whole path with the smallest broker volume: queue, confirm, send, fill or rest, stop and target attached, close, reconciliation from broker evidence, emergency stop cancels everything. Nothing is called working until this evidence exists.
5. **Customer readiness checks.** Verify for a live account: onboarding/connection flow, live labels everywhere (never mixed with demo), cash-at-risk and margin shown as estimate, per-user limits enforced, alerts on fills/refusals, assistant answers about live accounts correctly, no user can see another's money.
6. **Tests and scans.** Live-path tests (gates off refuse, confirm/decline ownership, expiry, no resubmit on unknown), full suite, typecheck, security scan, production build.
7. **Staged opening (your decision each step).**
   - Stage A: customer live **confirm** on for a small invited group; every trade needs owner approval.
   - Stage B: after a set number of confirmed live trades settle cleanly, consider customer live **auto**.

## What I need from you

- Whether you want step 4 run on your own real account first (recommended), and at the broker's minimum lot.
- Which customers go in the first live group.

## Unchanged

Demo auto-trading, scanner, grading, research and the no-fabricated-data rule stay as they are.
