# D1–D3 Corrections: Genuine Point-in-Time Baseline, Locked Documents, Tier-0 Preservation

Testing/CI work is paused. This change corrects the integrity-baseline layer only. No ABC, grading, entry, stop, target, replay, alert or learning formula is touched.

## 1. Make the baseline a real point-in-time capture

Current behaviour (verified in `src/lib/baseline/capture.server.ts`): the pinned learning run is chosen first, then each source is read live in separate round trips. Rows written between the first and last read land in the document, and `captured_at` is `new Date()` — so the document is a smear across the capture window, not a snapshot.

Correction — the cutoff approach (no single-statement rewrite, so the SQL surface stays untouched):

- `data_as_of = pinned_run_at` (`regime_snapshots.computed_at` of the pinned run). It becomes a required top-level field of the stored JSON alongside `captured_at`, with a note that `captured_at` is wall-clock bookkeeping and `data_as_of` is the semantic instant.
- Every time-varying source used in the official document gets a cutoff:
  - `shadow_executions` — `detected_at <= data_as_of`; a row whose `resolved_at` is after the cutoff is counted as *not yet resolved* at that instant, so fill/win/R aggregates only ever see outcomes that existed then.
  - `scanned_signals` — `detected_at <= data_as_of`.
  - `scan_queue` — `enqueued_at <= data_as_of`.
  - `webhook_dispatch_log`, `executed_trades`, `signal_user_telemetry` — `created_at <= data_as_of`.
  - `regime_snapshots` pinned rows — already immutable and run-scoped; unchanged.
- Prior-calibration pairs inherit both cutoffs (signal detected at or before, outcome resolved at or before), so calibration cannot borrow a future resolution.
- `caveats` gains one line stating that all counters are as-of `data_as_of` and will not match a live dashboard read.

Because the pinned run id is the idempotency key and `data_as_of` derives from it, re-running capture against the same run remains a no-op and now also reproduces byte-identical aggregates.

## 2. Lock the raw documents to service-role/admin only

Migration:
- `DROP POLICY baseline_snapshots_readable_by_authenticated`
- `REVOKE SELECT ON public.baseline_snapshots FROM authenticated`
- `service_role` keeps `ALL`. No new anon or authenticated policy. RLS stays enabled, leaving the table with no permissive policy for ordinary users, which is the intent.

Code consequence that must ship in the same change: `getBaselineStatus` in `src/lib/baseline.functions.ts` currently reads through `context.supabase` (the caller's RLS) and would start returning zero rows. It gets the same owner-email gate `runBaselineCapture` already uses, then reads through the admin client imported inside the handler. The admin dashboard surface (`BaselinePanel.tsx`, `/admin/intelligence`) is unchanged in behaviour and remains owner-gated.

## 3. Preserve Tier-0 volatility boundaries prospectively

`recompute_regime_stats` writes snapshots with `WHERE s.tier >= 1`, so Tier-0 rows — which carry the per-instrument volatility tercile boundaries `vol_t1`/`vol_t2` the live scanner reads — are destroyed by the next hourly rebuild and are unrecoverable.

- The snapshot insert changes to `tier >= 0`, version-filtered as it already is, and carries `vol_t1`/`vol_t2` (two columns added to `regime_snapshots` for that purpose, nullable, no default).
- No historical Tier-0 rows are fabricated. Snapshots before this migration keep no Tier-0 rows, and the baseline records that gap as a caveat.
- Read paths that display learning history stay Tier-1-and-above so the UI is unchanged: `loadRegimeSnapshots` in `src/lib/queries.ts` gains `tier >= 1`, and `LearningHistory.tsx` renders exactly what it renders today.
- `recompute_regime_stats` returns the Tier-0 snapshot row count in its existing JSON result for auditability. Its arithmetic — k=30 shrinkage, tercile computation, tier hierarchy — is not modified.

## 4. Source coverage metadata

New `source_coverage` block in the baseline document, one entry per source: row count as-of the cutoff, earliest and latest timestamp observed, the timestamp column used, and the retention rule that bounds it —

| Source | Bound stated |
|---|---|
| `scan_queue` | pruned at 7 days by `maintain_scan_queue`; older cycles unobservable |
| `scanned_signals` | tiered hard delete (C 24h, B 36h, A/A+ 48h) after expiry; grade/session distribution of deleted rows unrecoverable |
| `shadow_executions` | no retention rule; full history, but rows resolved after the cutoff are excluded by design |
| `webhook_dispatch_log` | pruned at 14 days |
| `executed_trades` / `signal_user_telemetry` | user-deletable from Trade History; counts are a lower bound |
| `regime_snapshots` | 180-day retention; no Tier-0 rows before this change |

Where a source is empty, the entry states so with null timestamps rather than a plausible default.

## 5. Verification I will report verbatim

After the edits I will run and paste the exact commands and their output:
- `bun run typecheck` (or `tsgo` if no such script exists — I will report which)
- `bun run build`
- the contents of the post-edit build log

There is no `.github/` directory in this repo and the git remote is not GitHub, so no GitHub status check exists. I will not claim CI passed; only the local build/typecheck results and, after capture, the stored document's `data_as_of`.

## Technical summary
- One migration: drop the authenticated baseline policy, revoke the grant, add `vol_t1`/`vol_t2` to `regime_snapshots`, replace `recompute_regime_stats` with the `tier >= 0` snapshot insert (formulas byte-identical otherwise).
- `src/lib/baseline/capture.server.ts`: `data_as_of` derivation, per-source cutoffs, resolution cutoff, `source_coverage`, added caveats.
- `src/lib/baseline.functions.ts`: owner gate plus admin-client read in `getBaselineStatus`.
- `src/lib/queries.ts`: `tier >= 1` filter on the snapshot history read.
- No other functional change.

## Out of scope
No new tables, no scanner or replay behaviour change, no retention-rule change, no backfill of any historical row, and no resumption of the testing/CI work.
