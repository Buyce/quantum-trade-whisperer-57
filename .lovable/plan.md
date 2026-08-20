# Add a "User-reported win rate" tile to the Admin Terminal

The existing "Taken win rate" tile is shadow-engine replay outcomes for signals users marked taken. It does not reflect what users actually logged. This adds a second, clearly distinct tile fed by users' own trade log, so the two can be compared side by side.

## What changes

1. Rename the existing tile to **"Taken → shadow win rate"** with a hover hint: "Deterministic replay outcome for setups users marked taken — not user-reported."
2. Add a new tile **"User-reported win rate"** with a hover hint: "From users' own logged trade outcomes in Trade History."
   - Value: win rate over resolved user-logged taken trades.
   - Sub-line: `n=<count> · mean R <value>`.
   - When no user has logged a resolved outcome yet, it reads "no user-logged outcomes yet" (zero-hallucination: no filler numbers).

## Definition of the new metric

Source: `executed_trades` rows with `user_decision = 'taken'` and `outcome` in `win` / `loss` / `breakeven` (open trades excluded).
- win rate = wins / resolved
- mean R = average of `realized_r_multiple` where present
- Aggregate only; no per-user rows, no user ids leave the server.

## Technical notes

- Migration: extend `public.get_admin_intelligence()` to add a `user_reported` object inside the `engagement` block (n, wins, win_rate, mean_r). Admin guard (`is_admin()`), `STABLE SECURITY DEFINER`, and the 3s statement timeout stay exactly as they are.
- `src/lib/admin.functions.ts`: add `user_reported` to the `AdminEngagement` type.
- `src/routes/_authenticated/admin/intelligence.tsx`: relabel the shadow tile, add the new `StatCard`, both with `InfoLabel`-style hints consistent with the rest of the terminal.
- No change to grading, alerts, the learning engine, or any user-facing page.
