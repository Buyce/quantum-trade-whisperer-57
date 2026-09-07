# Make the automatic-order hold clear, and let you set it

Today nothing was placed because your losing-streak protection is holding new
automatic orders: the last 4 closed broker trades were losses and your limit is 4.
It is due to lift at midnight UTC. That is the rule working, but the app explains it
badly and gives you no say over how long the pause lasts or how long a losing run
has to be.

## 1. One clear notice instead of the repeated paragraph

At the top of the automatic-orders area, a single notice while a hold is active:

- What is held: new automatic orders only. Anything already at your broker is untouched.
- Why, in one line: e.g. "4 closed trades in a row were losses (your limit: 4)."
- When it lifts: the exact time, plus a live countdown.
- Where to change it: a link straight to the setting.

Each setup row below then simply reads **no order** with a short tag such as
"held by losing-streak protection" — the long paragraph is removed from every row,
and from the seven-day refusal summary (which keeps its count).

## 2. You choose how long the pause lasts

New choice next to the losing-streak limit:

- 3 hours
- 5 hours
- Rest of the trading day (current behaviour, lifts at midnight UTC)

The chosen length is measured from the moment the hold started, so the notice and
the countdown always show the real release time. Existing accounts keep
"rest of the day" so nothing changes for anyone silently.

## 3. You choose the losing-streak length

The free-typed number becomes a clear choice of **4, 5, 6, 7 or 8** losing trades
in a row, with "off" still available. Each option says plainly what it means:
a lower number stops you sooner in a bad run; a higher number lets a normal losing
patch pass without pausing the day.

## What does not change

- The count still comes only from real closed broker trades and your broker's own
  equity — never an estimate.
- The daily, weekly and equity-drop limits keep their current behaviour and wording.
- No relaxation of any other order check (spread, slippage, exposure, news, order
  window, target rules), no live-trading changes.
- If your closed trades or equity cannot be read, orders are still held rather than
  let through.

## Technical notes

- New `scanner_settings` columns: `consecutive_loss_pause_hours` (null = next UTC
  day, else 3 or 5) and validation in the settings save path; defaults preserve
  today's behaviour for every existing row.
- `src/lib/risk/brakes.ts`: `consecutive_loss_limit` branch computes
  `resumeAfterMs` from the chosen window (`paused_at + hours`) with a new
  `resumeBoundary: "duration"`; the resume text is generated from that value so the
  notice, `pause_detail` and the countdown cannot disagree. Pure-function tests cover
  3h/5h/next-day boundaries and the no-backward-resume case.
- `brakes.server.ts` continues to persist `paused`, `pause_reason`, `pause_detail`,
  `resume_after`, `resume_boundary`; the enqueue and pre-send gates read the same
  verdict, so both paths honour the shorter window without duplicate logic.
- New banner component reads the account's persisted pause state through the
  existing accounts read path; `AutoOrderDecisions.tsx` drops the per-row detail for
  brake decisions and renders the short tag instead.
- Settings, Guide FAQ and `docs/RISK-GUARDIAN.md` / `docs/EXECUTION.md` updated in
  the same change, with the docs-contract test extended to cover the new wording.
