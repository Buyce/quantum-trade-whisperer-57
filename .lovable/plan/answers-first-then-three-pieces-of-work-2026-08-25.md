# Answers first, then three pieces of work

## 1. Why the diagnostic run showed only two instruments

The manual run enqueued three jobs (XAUUSD, GBPAUD, EURUSD — the three live
instruments) and then drained the queue itself. The background scan worker runs
every two minutes and claimed one of those three jobs first. When the manual
drain asked for the next job and got nothing, it stopped and printed the two it
actually processed. So the third instrument was scanned — just by the worker, not
by your click, and its outcome went to the feed instead of the panel.

That is a reporting gap, not a scanning gap. Fix: the panel will report the run's
whole outcome, including jobs another worker completed, and say so explicitly
("1 completed by the background worker") instead of silently listing fewer rows
than it enqueued.

Session state is not why an instrument is absent, and the panel should stop
looking like it might be: scanning is not filtered by your Active-sessions
preference. Sessions filter what reaches your feed and alerts. The scanner reads
candles whenever the market is open.

## 2. B-grade signals: nothing is broken, the market changed

Read from the live database, not inferred:

| Day (UTC) | B-grade | C-grade |
| --- | --- | --- |
| 24 Aug | 50 (XAUUSD 42, GBPAUD 8) | 10 |
| 25 Aug | 2 (XAUUSD) | 29 |

Grading is unchanged and still on model version 1. B requires H1 and M15 to
agree; today's rows carry 0-2 of 4 pillars and confidence in the 20-35 range,
which is exactly what a non-aligned market looks like. Yesterday's 42 B-grade
XAUUSD rows came off the same code. So you did receive B-grade today (2 XAUUSD),
just far fewer, because fewer structures aligned.

What I will add so this question never needs a database query again: the feed's
filter bar will show today's actual grade mix (for example "today: 2 B, 29 C")
next to "10 shown", so a quiet B day is visible as a market fact rather than
looking like a broken filter.

## 3. Are all instruments scanned and measured properly

Three are: XAUUSD, GBPAUD and EURUSD. They are scanned every 15 minutes and now
also measured every 15 minutes by the spread sampler, which stored real broker
spreads this morning (XAUUSD 43 points, GBPAUD 0.5 pips) and correctly refused to
record EURUSD's zero-spread tick as a spread.

The five Wave 1 pairs (GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF) are deliberately
`disabled`: not scanned, not measured, not published. That is the agreed
sequencing — they enter data collection only on your explicit approval, and no
step in this plan changes any instrument's stage.

## 4. C-tier automatic orders (the change you asked for)

Today C-grade can already trigger push and email alerts. Only automatic orders
refuse it, unconditionally. That becomes your choice, off by default.

- One user-level switch in Rules, alerts & automatic orders: "Allow C-grade
  automatic orders". Off unless you turn it on, and turning it on requires
  confirming a plainly worded warning.
- Scope you chose: no extra ceiling. A C-grade order must still pass every
  existing gate — your instruments, your sessions, your alert tier, risk per
  trade, the lot ceiling, exposure, the pre-send broker re-check, and the
  intelligence gate if you have it on.
- The intelligence gate matters most here: with fewer than 30 resolved filled
  samples for that regime it refuses, so an unmeasured C regime produces no
  order even with the switch on.
- Every decision stays in the decision log with an honest reason:
  `c_grade_blocked_by_user_setting` when the switch is off,
  `c_grade_allowed_by_user_setting` when it fires.
- Copy in Settings and the Guide that currently states "C is never executed
  automatically" changes to describe the switch truthfully.

## 5. Mobile audit and fixes

I will drive a real browser at 390 x 844 and 768 px through feed, history,
performance, accounts, settings (all six tabs), connect, guide and the admin
terminal, screenshot each, then fix what is defective. Known suspects from the
code: the new instrument-diagnostics tables, the automatic-trading summary rows,
the wide signal-card badge row, and the intelligence-gate number inputs.
Broker accounts is reachable on phones only via Settings, which I will make
explicit rather than leaving it to be discovered.

Nothing in this pass changes grading, sizing or lifecycle stages.

## Technical detail

- `src/lib/scanner/scan.functions.ts`: after the drain, re-read `scan_queue` for
  the run and report per-instrument terminal state plus a `claimedByWorker`
  count; surface it in the Settings > Diagnostics panel.
- Feed grade mix: derive from the already-loaded day frame in the feed route —
  no new query, no new endpoint.
- Migration: add `scanner_settings.auto_execute_c_grade boolean not null default
  false`.
- `src/lib/delivery/direct-enqueue.server.ts`: replace the unconditional
  `signal.grade === "C"` refusal with a settings read; add the two reason codes
  to `enqueue-log.ts`. Order of gates unchanged, so C still faces the alert-tier,
  session, instrument, intel-gate and revalidation checks.
- Tests: C refused when the flag is false (keeps the current invariant), C
  allowed only when the flag is true and every other gate passes, C still
  refused by the intel gate on thin samples, and the drain reporter counting
  worker-claimed jobs.
- Docs: `docs/EXECUTION.md`, `docs/ALERTS-AND-ELIGIBILITY.md`, `docs/SCANNER.md`
  and the in-app Guide.
- Mobile fixes stay in presentation code (Tailwind classes, wrapping, table
  overflow); no business logic touched.
