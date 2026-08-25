# Clarify the two win rates in the Admin Terminal

Both numbers are computed correctly — they just measure different things over different rows, so they should not match.

## What the data actually shows

Verified against live rows:

| Metric                   | Source                                               | n                       | Win rate                |
| ------------------------ | ---------------------------------------------------- | ----------------------- | ----------------------- |
| Discipline index → Taken | Shadow replay outcome for signals users marked taken | 25 decisions, 14 filled | 21.4% (wins / filled)   |
| User-reported win rate   | Users' own logged outcomes in Trade History          | 19 resolved             | 47.4% (wins / resolved) |

Why they diverge:

- The discipline row counts only shadow-filled replays; 11 of the 25 taken signals never filled in replay and are excluded from its win rate.
- The user-reported row counts whatever outcome the user logged, at the user's real entry/exit — which differs from the deterministic replay (users often close manually at partial targets, so more get logged as wins).

So the discipline index is correct as "what the replay engine says about setups users took", and 47.4% is correct as "what users say happened".

## One genuine inconsistency to fix

In the discipline table, `Mean R` averages `realized_r` across all joined rows including never-filled ones (which carry 0), giving -0.30, while the shadow win-rate tile averages only filled rows, giving -0.54. Same population, two different denominators — confusing side by side.

Fix: make the discipline `Mean R` filled-only, so it reads -0.54 and matches the shadow tile.

## Labelling changes (presentation only)

1. Discipline panel title becomes "Discipline index — shadow replay outcome (skipped vs taken)".
2. Column header `Resolved` becomes `Decisions`, and `Filled` gets a hover hint: "Only filled replays count toward win rate and mean R."
3. Add a one-line footnote under the discipline table: "Replay outcomes, not user-reported. Compare with the User-reported win rate tile above."

## Technical notes

- Migration: in `public.get_admin_intelligence()`, change the discipline `mean_r` aggregates (taken and skipped) to `avg(realized_r) FILTER (WHERE resolved_outcome <> 'never_filled')`. No other logic touched; admin guard, `STABLE SECURITY DEFINER` and timeout unchanged.
- `src/components/admin/AdminPanels.tsx`: `DisciplinePanel` header/labels + footnote.
- `src/routes/_authenticated/admin/intelligence.tsx`: panel title only.
- No change to grading, alerts, the learning engine, or any user-facing page.
