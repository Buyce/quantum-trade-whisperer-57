# Admin Intelligence page fails to load — diagnose, then make it un-blankable

## What is happening

The screenshot is the app's root error screen ("This page didn't load"), which
means something threw while the Admin Intelligence route was loading or
rendering — not a panel-level empty state or a failed database read (those
render their own inline red text).

What the logs rule out so far:

- Latest build: `build OK`.
- Preview runtime-error and console logs captured with your message: empty.
- Dev server: healthy, no startup failure.
- Worker logs in the last hour contain only MetaApi 429 rate-limit errors from
  the scanner and order-expiry jobs — unrelated to this route.

So the exact cause is **not yet confirmed**. Confirming it is step 1 of this
plan, not an assumption inside it.

## Step 1 — Capture the actual error

Reproduce on the running preview with an owner session and record the browser
`pageerror`, console output, failed network requests and the loaded chunk list
for `/admin/intelligence`. The two live suspects to confirm or eliminate:

1. **Stale code chunk.** The route is lazily code-split. If the deployed
   bundle asks for a chunk that no longer exists (the app has not been
   published since the last schema/route change), the dynamic import rejects
   and the root boundary shows exactly this screen.
2. **A render-time throw in one panel.** Several admin panels format dates with
   `new Date(x).toISOString()`. On a null/invalid timestamp that throws
   `RangeError`, which React cannot catch inside the panel — it escalates to
   the root boundary and blanks the whole terminal. Confirmed unguarded spots:
   `FilterLiftPanel` (generated_at), `LearningEvidencePanel` (snapshot
   `as_of`, override `updated_at`, cohort `applied_at`). These are currently
   dormant because `filter_lift_stats`, `gate_change_proposals` and
   `gate_threshold_overrides` all have 0 rows — but they become live the moment
   the first row appears.

## Step 2 — Fix what step 1 shows

- If it is a stale chunk: publish so the deployed app matches the current
  build, and add a chunk-load-failure recovery path (detect the dynamic-import
  failure and reload once instead of showing the dead-end error screen).
- If it is a render throw: fix the throwing expression at its source.

## Step 3 — Make the terminal un-blankable (regardless of step 1)

The Admin Intelligence page is one route rendering ~25 independent panels. One
bad row in one panel should never take down the terminal.

- Wrap each panel in a small error boundary that renders an inline "this panel
  failed" note with the message, keeping every other panel alive.
- Replace every raw `new Date(x).toISOString()` in admin components with the
  existing safe formatter pattern (`Number.isFinite` check → `—`), so a null or
  malformed timestamp degrades to a dash instead of throwing.

## Technical notes

- Files in scope: `src/routes/_authenticated/admin/intelligence.tsx`,
  `src/components/admin/FilterLiftPanel.tsx`,
  `src/components/admin/LearningEvidencePanel.tsx`,
  `src/components/admin/AdminPanels.tsx` (shared safe-date helper + panel
  boundary), and `src/routes/__root.tsx` only if chunk-reload recovery is
  needed.
- No backend, RLS, scanner, execution or eligibility logic changes. No data is
  written, seeded or synthesized; empty tables keep rendering their existing
  zero states.
- Tests: unit coverage for the safe date formatter (null / invalid / valid) and
  for the panel boundary isolating a throwing child.
