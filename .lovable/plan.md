# The intelligence gate IS saved — the display is what lies

## What I verified

Your saved row in the database currently holds exactly what you entered:

- gate enabled: true
- minimum win-if-filled rate: 42
- minimum filled samples: 40
- last written: Aug 25, 05:18 UTC

So the "Settings saved" toast was truthful and the gate is active. What is wrong is only the screen: after saving, the page refetches your settings, and the query that fetches them does not ask the database for the three gate columns. They come back as undefined, and the form's hydration step then falls back to its defaults — off, blank threshold, sample 30 — overwriting the values you just saved on screen. Nothing in the database changes at that moment.

## The fix

- Add the three gate fields to the settings fetch so the form re-hydrates from what was actually stored.
- Keep the hydration fallback honest: if a field genuinely comes back missing, do not silently show "off" for the gate. Show the stored state, and treat a truly absent value as unconfigured rather than as a deliberate "off".
- Same check across the other fields on this tab, so no other control can silently revert on screen while being saved in the database.

## Guard against the class of bug

A round-trip test asserting that every field the settings form writes is also selected by the settings read query — so a future field cannot be saved-but-invisible again.

## Technical notes

- `settingsQuery` in `src/lib/queries.ts` omits `auto_intel_gate_enabled, auto_intel_min_win_pct, auto_intel_min_sample` from its explicit `select(...)` projection; the hydration effect in `src/routes/_authenticated/settings.tsx` (lines ~229-231) then coerces the undefined values to `false` / `""` / `30`.
- No migration, no policy, and no grant change is needed — the write path and the gate logic in `src/lib/delivery/direct-enqueue.server.ts` are already correct.
- New test compares the write payload keys in `onSave` against the projection string in `settingsQuery`.
