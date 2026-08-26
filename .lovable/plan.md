# Admin Intelligence — answers, then collapsible panels

## 1. What "Rebuild cohorts" does

It re-runs the payoff research aggregation (`recompute_payoff_stats`) for two identities in one press:

- model v1 · replay v1 · `legacy_best_target_touched` (the production tuple)
- model v1 · replay v2 · `single_exit_first_target` (the research replay identity)

Each run takes its own advisory lock, stamps its own frozen `as_of` instant, and rewrites only the payoff research tables. It does **not** touch `regime_stats`, the learning priors, grading, signal ranking, alerts, or any published signal. It is owner-only and service-role-executed.

**Why it exists.** The numbers you see (Mean R, 95 % interval, mature plans, traded, never-filled 0R, replay coverage) are aggregates over shadow rows that keep resolving over time. Nothing recomputes them on a schedule — there is no cron job for payoff stats. So the panel shows whatever the last press produced. Pressing it refreshes the research view to the current resolved population.

**When it is necessary.** After a meaningful batch of shadow rows has resolved — practically, once a day or before you read the payoff numbers to make a decision. Pressing it more often just re-reads the same rows and moves the `as_of` stamp forward.

**Is there a limit? Does it affect other users?** No count rule; it is idempotent and safe to repeat. It affects nobody else — it is a research read surface visible only to the owner, and no user-facing behaviour changes.

## 2. What "Capture baseline" does

It writes **one immutable baseline document** pinned to a single learning run: fill rate, win-if-filled (Wilson intervals), win per signal, mean R over resolved rows, plus the recorded caveats and the `data_as_of` instant.

- Immutable by design: a second press for the same pinned learning run is rejected with "a baseline is already recorded for learning run …; the stored document is authoritative and was not overwritten." Nothing is overwritten, ever.
- Also manual by design (no cron): a background loop would produce a stream of documents and destroy the meaning of "the baseline".

**When it is necessary.** At real milestones only — before a model promotion, before/after a lifecycle or execution-policy change, or when you want a citable, frozen snapshot of engine quality. Not routine.

**How many times?** Once per learning run at most; the DB enforces that. It affects no other user and changes no live behaviour.

**Key distinction:** Rebuild cohorts = refresh a research view (repeatable). Capture baseline = pin history (once, permanent).

## 3. Make the whole Admin Intelligence terminal collapsible

Every block on the page — engine status, execution switch, enqueue decisions, instrument diagnostics, commissioning, news, baseline, grading research, payoff research, candidate capture, author split, integrity, grade calibration, webhooks, volume, weekly comparison, replay monitor, intersection telemetry, and the small three-up grids — already renders through one shared shell component. So this is one change plus a small amount of wiring.

### Behaviour

- Each panel header becomes a click target with a chevron; the body expands/collapses.
- **Collapsed by default**, except the engine heartbeat and execution switch, which stay open (they are the safety-critical status you always want on screen).
- Open/closed state is remembered per panel in local storage, so your layout survives a reload.
- A header control: "Expand all / Collapse all".
- Collapsed panels do not render their body, so their own data fetches do not run. That makes the page dramatically lighter — today every panel queries on mount. Open panels behave exactly as now.
- The top summary stat cards stay visible as a fixed overview strip.
- Mobile: full-width header rows with truncating titles and a fixed-size chevron, so nothing clips at 390 px.

### Explicitly not changed

No change to grading, sizing, lifecycle stages, execution gates, enqueue rules, payoff or baseline mathematics, or any server function. Presentation only.

## Technical notes

- Extend `PanelShell` in `src/components/admin/AdminPanels.tsx` with `collapsible`, `defaultOpen`, and a `storageKey`, built on the existing shadcn `Collapsible` primitive; children render only while open. The current signature (`title`, `right`, `children`) stays valid so no call site breaks.
- Add a small `usePanelOpen` hook reading/writing `localStorage` after hydration (never in a `useState` initializer, to avoid a hydration mismatch).
- Pass a stable `storageKey` per panel from `src/routes/_authenticated/admin/intelligence.tsx`, and from the panels that render their own shell (`EngineStatusPanel`, `NewsPanel`, `CommissioningPanel`, `InstrumentDiagnosticsPanel`, etc.).
- Add an expand/collapse-all control next to the existing Refresh button, coordinated through the same storage keys.
- Add tests for default-open/closed resolution, persistence round-trip, and that a closed panel does not mount its body.
