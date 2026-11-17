# P-Trades repair and learning programme: staged plan

Baseline: the local checkout is at `415d2542`, which matches the last reviewed revision. Every stage is additive and can be rolled back separately. Throughout this work, no account modes, arming, tokens, risk settings, sizing, stops, targets or order thresholds change, and no orders are sent.

## Stage 0: Baseline record (read-only)
- Record the revision, schema and migration history, execution and telemetry flags, live account mode and arming state (read only), worker health and scheduled jobs.
- Identify which origins can dispatch orders: preview, published app and cron. Confirm that only one dispatcher, the scheduled worker against the shared backend, is able to send.
- Map who consumes trade evidence (History, Performance, the assistant/MCP, reconciliation, learning) and the tests that protect each one.
- Rollback point: the revision ID and migration list are recorded in the report. Git history is not rewritten.

## Stage 1: Chronology of ticket 49064728 (priority one)
Investigate before changing anything. The leading hypothesis is still unconfirmed: the entry was saved before the brokerTime-as-UTC fix (`415d2542`), so `10:36:07` would be broker-local time stored as UTC.
- Read-only MetaApi calls: account mapping and region, the deals and history orders for this position (`time` and `brokerTime`), and server time. Check these against delivery `submitted_at`, the signal's `detected_at` and the database `now()`.
- Confirm that the order, position and client ID match across the setup, delivery and evidence records.
- Count how many trades are affected: evidence rows where entry is earlier than submission, or where `entry_time − brokerTime` is a whole number of hours.
- Repair: add an append-only `broker_evidence_time_corrections` table. Each row holds the raw value, corrected value, rule, source deal, actor and timestamp. Closed evidence rows are never rewritten. Readers use a view that coalesces the latest validated correction.
- Add a `chronology_status` flag (validated / suspect / unknown). Suspect rows are excluded from chronological learning and feature reconstruction, but stay visible in History with their money unchanged.
- `profit_currency`: fill it only from MetaApi account-information `currency` for the linked account, and record that source. If the currency is not available, leave it null.
- Tests: DST boundaries, missing `time`, zone-less `brokerTime`, impossible chronology (entry before submission) and an immutability guard.

## Stage 2: Verify learning repairs in the running backend
For Q-Core cohort join, advancement null R, walk-forward paging and capped-read refusal, collect from live tables:
- whether enabled; last attempted and last successful run
- cutoffs
- eligible, fetched, matched, excluded and processed counts
- model, replay and policy identities
- refusal state and errors

Compare eligible counts (`count(*)`) with fetched counts to detect the server's 1,000-row limit. Each subsystem is classified as healthy, disabled, immature, failed, stale or refusing. Optional: a new `learning_run_log` table (additive) written by each job, plus an Admin status matrix.

## Stage 3: Evidence identity and provenance (findings 1–11)
Each finding gets a verdict with a source reference, a schema query, its impact and a test. Expected repairs, all limited to research and reporting:
- Readers filter by active model, replay and exit policy.
- Payoff selection uses an explicitly approved population instead of the largest sample.
- Benchmark labels say "self-reported" when the data comes from the journal.
- Q-Core arithmetic is checked to be sensitive to decisions.
- Payoff snapshot freshness and exit-policy match are checked.
- Execution-quality statistics separate pre-send refusals, dry runs and broker rejections.
- Walk-forward is keyed to the exact proposal and configuration, with a horizon check.
- Unused foundations (digital twin, flight recorder, kernel) are documented as such.
- The current values of flags for enrolment, automation, proposals, apply and rollback are read and reported.
- "Self-learning" is described accurately.

No promotions and no changes to live gates. Any change in behaviour becomes a separate proposal.

## Stage 4: Personal MT5 history ledger
- New tables: `personal_broker_deals` (unique on provider, account and deal ID; raw JSON; normalizer version; origin class) and `personal_history_sync` (checkpoint, covered interval, completeness, errors, truncation). Both are owner-scoped with RLS, and the backfill server function checks ownership.
- Backfill reads in time chunks (for example 7-day windows, with paging), then syncs incrementally from the checkpoint.
- Origin classes: P-Trades automatic, P-Trades with manual intervention (linked through the existing matcher only), personal manual, external EA or unknown, and balance operations kept separately. A magic number of 0 alone does not prove manual origin.
- Handles partial and close-by deals, reversals, hedging and netting, commissions, swap and fees, with currency taken from account info.
- The existing P-Trades matcher and performance consumers are not changed.
- Start with one verified week: reconcile deal count and net money against the broker, then expand. Report coverage only for intervals that were verified.
- Read-only Personal history view, separate from strategy performance. No R values are invented and there is no automatic retraining.

## Stage 5: External research
Cite MetaApi docs (history deals, `time`/`brokerTime`, pagination limits), MQL5 deal and position semantics, and inspected public projects. Cover costs, correlation, selection bias, leakage, multiple testing and regime change.

## Per stage
Each stage gets tests that reproduce the failure, targeted vitest runs, a typecheck, the build log, a security/RLS scan and rollback notes. Statuses are reported separately: implemented / tests verified / published / observed in production / blocked.

## Known limits
- Previous audit files that are not in uploads will be named as missing.
- Confirming production behaviour requires you to publish.
