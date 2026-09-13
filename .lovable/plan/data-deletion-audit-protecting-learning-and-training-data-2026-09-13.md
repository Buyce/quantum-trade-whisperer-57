# Data-deletion audit: protecting learning and training data

## What I checked

Live database functions and scheduled jobs, every delete path in the app code, and the
foreign-key rules between setups and the learning tables.

## What I found

**1. The hourly signal clean-up is broken right now (and has been failing every hour).**
The clean-up routine tries to copy each expiring setup into an archive table
(`public.signal_retention_archive`) before removing it — but that table does not exist in the
database. Every hourly run ends in an error. Practical effect: nothing has been deleted (all 823
recorded setups are still present), but a scheduled job is failing continuously and the archive
that was supposed to protect this data was never created.

**2. If it were working, it would remove data that learning depends on.**
When a setup row is deleted, the database also removes or unlinks:
- `market_context` for that setup (row deleted; only a JSON copy would live in the archive)
- `executed_trades` rows for skipped decisions, and `signal_user_telemetry`
- and it blanks the link to the setup on `shadow_executions`, `model_observations`,
  `research_candidates.published_signal_id`, and `sizing_divergence_log`

So the replay outcome, the research candidate, and the model observation would survive but lose
the thread back to the setup they came from. Trades that were actually taken, deliveries that
reached a broker, and broker evidence are already protected from deletion.

**3. A lineage gap already exists.** 670 replay rows have no link to either a setup or a research
candidate (1,202 are candidate-linked, 1,872 have no setup link in total). Also, all 11,228 model
observations have an empty setup link. Both need confirming as intentional design versus loss
before anything else is changed.

**4. Other timed deletions exist.** Measurement history is trimmed on schedules: spread samples,
volatility snapshots, capacity samples and broker API observations (retention-controlled), news
events after 400 days, and regime/payoff snapshots after 180 days. Derived statistics tables are
fully rebuilt each run, which is normal. Account closure deletes that user's own journal and
settings, which is the intended privacy behaviour.

## Proposed work

1. Create the missing archive table with grants, owner-only access, and immutability, so the
   hourly job stops failing and every removed setup keeps a full copy: the setup row, its market
   context, its replay link, grade, model version and provenance.
2. Change the removal rules so learning keeps its thread: before deletion, stamp the durable
   identifying fields (instrument, direction, grade, detected time, structure key, model version)
   onto the replay, research-candidate and observation rows, so blanking a link never loses
   provenance. Keep replay/candidate/observation rows themselves permanently.
3. Confirm whether the 670 unlinked replay rows and empty observation links are by design; if they
   are recoverable from existing columns, backfill them; if not, record the finding honestly in the
   data dictionary rather than inventing links.
4. Review the retention windows for spread/volatility/capacity/API-observation history against
   what the adaptive spread and quality models actually read, and lengthen any window that is
   shorter than the learning lookback.
5. Add a small Admin health line for clean-up jobs (last run, outcome, rows archived) so a silent
   failure like this one is visible.
6. Tests plus documentation updates (Operations, data dictionary) covering the archive contract and
   "learning rows are never deleted".

## Technical notes

- Clean-up routine: `public.purge_expired_signals()` (hourly `purge-expired-signals` cron), failing
  with `relation "public.signal_retention_archive" does not exist`.
- Cascade/SET NULL rules confirmed via `pg_constraint` on `scanned_signals`.
- Other routines: `purge_telemetry()`, `purge_news_data()`, snapshot trims in
  `recompute_payoff_stats` / `recompute_regime_stats`.
- App-side deletes reviewed: scanner rollback of a half-written publish
  (`src/lib/scanner/pipeline.server.ts`), user journal deletes (`src/lib/queries.ts`), account
  purge (`src/lib/account.server.ts`), stale push subscriptions, spec-refresh attempts. None of
  these touch training rows beyond the user's own journal.
- No change to broker orders, positions, or live-execution gating.
