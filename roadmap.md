# Roadmap

## Part A — Grade recovery for orphaned broker trades

- [x] Migration: `signal_grade_source`, `signal_first_decision_at`, `signal_ref`, one-time-fill trigger
- [x] `grade-recovery.ts` / `.server.ts` + tests, wired into `recover.server.ts` and `reconcile.server.ts`
- [x] Backfill the 20 orphan evidence rows (writes `signal_ref`, not the FK `signal_id`)
- [x] Surface recovered grades in Trade History with a provenance marker
- [x] Performance: include recovered grades, report the recovered population separately

## Part B — Reduce "Not sent — refused by P-Trades"

- [x] `next_attempt_at` + backoff on retryable refusals; claim RPC skips future-scheduled rows
- [x] Terminalise runaway price gates; stop retrying when the window is shorter than the next step
- [x] Batch/fair claiming so one hot symbol cannot starve the queue
- [x] Move market-closed / spec-unavailable / window-floor checks to enqueue time
- [x] Admin refusal-cost panel (reasons, attempts spent, queue latency)
- [x] Settle the current pending backlog under the new rules (fair claiming now serves the 14 never-claimed 0-attempt rows before the hot row; nothing is force-settled by hand)
- [x] Enable research-candidate enrolment (flag flipped, verify on next hourly run)
- [x] Research backlog drain: candidate budget raised to 150/run, oldest detection first
- [x] Filter lift recomputed hourly after research resolution + admin Filter Lift panel (measurement only)
- [x] Per-candidate lineage panel (capture -> enrolment -> replay -> broker, "never sent" when rejected)
- [x] Rows older than the provider candle cap labelled `outside_replay_window` instead of sitting pending
- [ ] Restore `shadow_engine_state.candidate_rows_per_run` to 30 once the enrolable backlog reaches 0

## Part C — Blocked instruments (XAGUSD, USOIL, UKOIL, NAS100)

- [x] Migration: `instrument_symbol_bindings` (operator decision + candidate evidence), `broker_symbol_specs.provider_symbol`
- [x] Spec refresh fetches under the bound broker symbol and records which name it used
- [x] Mapping honours a binding as `configured`, usable only with a fresh spec fetched under that exact name
- [x] Owner-only bind / unbind / single-instrument commissioning recheck (evidence only, no stage change)
- [x] Promotion checkpoint short-circuits outside `data_validation` so disabled instruments read as "not under measurement", not "failing"
- [ ] Bind the operator-chosen tickers (NAS100, USOIL, XAGUSD) and confirm evidence before any stage change
- [ ] UKOIL: no Brent-like symbol found in the broker inventory; needs an operator-supplied ticker or stays disabled

## 2026-09-03 — NAS100 bound, USOIL rejected on evidence

- NAS100 bound to broker ticker `USTEC` (operator decision, full-size contract;
  `USTECH100M` kept as a recorded alias). Recheck under that name returned a valid
  specification, a live quote and complete H4/H1/M15 series, so NAS100 moved
  `disabled -> data_validation`. It publishes nothing until it earns the promotion gate.
- Readiness now asks the provider for the BOUND ticker when fetching candles and quotes
  (previously only the specification read used it), and the series validator treats an
  exchange venue's daily close as a reported-but-not-fatal `daily_break` for
  index/energy/metal. FX keeps zero tolerance.
- USOIL left UNBOUND on purpose: all five broker tickers (`WTI`, `WTIB`, `WTID`, `WTIP`,
  `WTIU`) are thin part-day contracts priced 2-37, not the crude oil market, and none was
  quoting live. Binding one would have produced a real but wrong instrument.
- Hourly enrolment run executed: 104 candidates enrolled (228 total enrolled), 124 older
  candidates labelled `outside_replay_window`.

## Evidence-grade filter evaluation + proposal workflow (archived plan 2026-09-03) — DONE

- filter_lift_stats: slice rows (instrument/direction/session), cluster-robust SE (instrument-day clusters), stat_status + reason.
- gate_change_proposals ledger + gate_threshold_overrides (approve/reject/revert, owner-only, audited via execution_control_changes).
- get_admin_learning_evidence RPC (rows/proposals/overrides/post-change cohorts).
- Scanner applies approved positive overrides at runtime; effective manifest hash flows into candidate provenance.
- Admin UI: LearningEvidencePanel (override form, decisions, slices, post-change cohorts).
- Fixed nested-aggregate bug in recompute_filter_lift; taxonomy prefixes; 1,430 tests green (resolved-immutability flaky only under parallel load).

- [x] Admin Intelligence resilience: per-panel error boundaries, safe UTC timestamp formatter (`src/lib/format-utc.ts`), stale-chunk single reload recovery in the root error boundary.

## 2026-09-03 — Slim down Admin Intelligence

- [x] Remove Refusal cost, Instrument lifecycle/telemetry, Commissioning status, Promotion checkpoint, and Economic Events panels from the page.
- [x] Keep Broker symbol bindings panel (operator decision surface for instrument tickers).

## 2026-09-05 — Later panel decision (supersedes the entry above)

- [x] Broker symbol bindings panel REMOVED from Admin Intelligence on owner instruction.
      Bindings themselves are unchanged and still honoured by spec refresh and readiness;
      only the Admin surface is gone.
- [x] Promotion checkpoint panel RE-INSTATED — it is the answer to "when do new signals
      become available to customers", so it stays mounted.
- The 2026-09-03 entry above records what was true that day and is left as written.

## 2026-09-05 — Documentation truth audit

- [x] New `docs/EXECUTION-QUALITY.md`: drawdown brakes, execution-quality scoring,
      24h cooldowns and evidence-ranked cap ordering (previously shipped, undocumented).
- [x] `docs/EXECUTION.md`: cap ordering + brake/cooldown cross-references.
- [x] `docs/PERFORMANCE-AND-STATISTICS.md`: named the three evidence tiers, corrected the
      deleted `src/lib/stats/wilson.ts` path, and resolved the holdout contradiction —
      `HOLDOUT_AVAILABLE = false` means no FORWARD sample; walk-forward is a retrospective
      chronological re-split of recorded history.
- [x] `docs/OPERATIONS.md`: sampling scope stated as `sampler_symbols` (8) rather than by
      stage, NAS100's data_validation-but-unsampled position recorded, stale review date removed.
- [x] `docs/README.md` + root README: index renumbered, new document linked.
- [x] New Guide section "Automatic safety limits": order ceilings, order window, drawdown
      brakes, quality cooldowns, the two overrides, adaptive spread ceiling, webhook/sender
      domain and broker telemetry.
- [x] `og:type` + `twitter:card` on `auth`, `settings`, `feed`, `history`.
- [x] Deleted five orphaned admin panel files (SymbolBinding, Commissioning, RefusalCost,
      InstrumentDiagnostics, News) — unreferenced since their panels were removed.
- [x] Four new documentation-contract assertions: every `*Panel.tsx` must be mounted;
      brake/cooldown constants must be documented; the holdout claim must not be
      contradicted and the deleted wilson path must not return; every safety control must
      have a Guide entry.
- [x] Repository-wide Prettier pass.
- Verified: tsgo clean, build OK, 1,606 checks pass (2 expected failures; the slow
  resolved-immutability DB check passes at a 30s timeout).
