# Make pause-triggered order cancellation always-on

## Why

The "Cancel matching unfilled orders when the pause starts" checkbox was shipped
off-by-default out of caution. The behaviour has since proven safe:

- It only touches orders that are **still unfilled** — filled or partly filled
  positions stay open.
- It only matches the **same instrument and direction** as the losses that
  triggered the pause.
- Only **broker-confirmed** cancellations count; anything the broker does not
  confirm is reported as unconfirmed, never assumed.

When a losing-run pause fires, its purpose is to stop adding exposure after
repeated losses on the same setup. Leaving identical resting orders live while
blocking new ones contradicts that purpose. So cancellation becomes the default
behaviour whenever a pause triggers — no choice to configure.

Scope note: if pause protection itself is switched off, no pause ever fires, so
nothing is cancelled. Always-on applies to pauses that actually occur.

## What changes

1. **Settings** — remove the checkbox and its explanatory block from
   Settings → risk section. Nothing to decide anymore.
2. **Logic** — the pause transition in the brake evaluator always runs the
   matching-cancellation pass; the per-user `cancel_matching_on_pause` flag is
   no longer consulted.
3. **Banner** — the risk-hold banner keeps reporting how many orders were
   cancelled and how many the broker did not confirm (unchanged, still truthful).
4. **Data** — the stored setting column is left in place (harmless, ignored)
   rather than dropped, so no destructive migration is needed. Validation that
   referenced it is simplified.
5. **Docs** — RISK-GUARDIAN documentation updated to state cancellation is
   automatic on every pause.

## What does NOT change

- Duplicate prevention on every order (always-on already, stays).
- Open/filled positions are never touched.
- The pause limits themselves (losses in a row, pause length) stay yours to set.

## Technical notes

- `src/lib/risk/brakes.server.ts` — drop the `cancel_matching_on_pause` gate
  around the cancellation pass in the pause transition.
- `src/routes/_authenticated/settings.tsx` — remove the checkbox UI, its state
  field, and save/load wiring.
- `src/lib/mcp/settings-validation.ts` + `src/lib/mcp/tools/update-my-settings.ts`
  — remove the field from accepted settings (keep ignoring it if sent).
- `src/lib/queries.ts`, `src/lib/db-types.ts` — remove the field from
  projections/types where no longer needed.
- Tests: update `pause-cancel` tests to assert cancellation runs regardless of
  the old flag; keep fail-closed and broker-confirmed cases.
- Verify: focused tests, full suite, typecheck, formatting, build.
- Publish afterwards so the change reaches the live site.

## Proof that duplicate prevention is working

Checked against live order data before making any change:

- In the last 7 days, **no signal produced more than one order on the same
  account** — the check for that returned zero rows.
- The refusal record shows the protection actively firing:
  124 "duplicate resting order" refusals in the last 48 hours, including
  34 today and 35 yesterday — each one an order that was stopped before
  reaching the broker.

This is also locked in by automated tests (`duplicate-orders.test.ts`,
`direct-enqueue.test.ts`), which fail the build if the check stops firing.
