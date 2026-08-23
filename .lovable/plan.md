# Prompt 14 — Stage 5: Broker Telemetry, Risk Guardian & Prompt-14 Closure

Stages 1–4 are in place: the MetaApi access layer, connected accounts and the
provisioning wizard, direct demo execution, and the broker-evidence
reconciliation worker. Stage 5 adds the observation layer on top and closes the
prompt: broker-reported account health, drawdown watching where the vendor
actually supports it, an account-wide exposure boundary before any direct
submission, and the evidence surfaces plus documentation that make all of it
readable.

## What Stage 5 delivers

1. Broker account telemetry
   - Per account, MetaStats metrics (trades, win rate, profit, expectancy,
     max drawdown, balance/equity) are read on a schedule and stored as
     timestamped snapshots labelled BROKER-DERIVED.
   - "Still calculating" is shown as exactly that. MetaStats answering with a
     retry hint is never rendered as zeros, and never as a losing account.
   - Reads are governed by a durable server-side budget (a per-account
     minimum interval plus a per-run cap), never by page views or polling from
     the browser.

2. Risk Guardian (drawdown watch)
   - Only offered where the vendor supports it. MT5 netting accounts are
     reported as unsupported, with the reason stated in plain words, rather
     than showing a tracker that is not watching anything.
   - A daily and a monthly drawdown tracker are created for eligible accounts;
     tracker events are read and stored so the account page can show what has
     actually breached, with the observation time.
   - Nothing here blocks or alters execution — it is observation and reporting.

3. Account-wide broker exposure boundary
   - Before any direct submission, the account's real open positions and orders
     at the broker are read. If the account already carries broker-side exposure
     beyond the configured account-wide boundary, the delivery is refused with a
     broker-derived reason instead of adding another order.
   - When the broker cannot be read, the answer is refuse (data unavailable),
     never assume flat.

4. Evidence and telemetry surfaces
   - `/accounts` gains a per-account panel: broker facts, symbol mapping,
     MetaStats snapshot with its observation time, Risk Guardian status
     (available / unsupported + reason), and recent tracker breaches.
   - A broker-evidence list per account: positively associated trades from
     Stage 4 with entry/exit, costs, R vs plan and R vs actual risk, and the
     evidence class (BENCHMARK / CUSTOMER / SELF-REPORTED).
   - The benchmark demo account gets an admin-side summary of the same
     evidence, kept separate from user self-reported journal statistics.

5. Prompt-14 closure
   - Documentation updated: architecture, execution, data provenance, glossary
     and operations gain the accounts / direct-execution / evidence /
     telemetry story, including the netting limitation and the budget.
   - The in-app guide gains a short "Connected broker accounts" section written
     for a non-quant reader.
   - Blocking tests for every new rule, then a full suite and build run.

## Non-negotiables carried forward

- No fabricated numbers. Absent broker data renders as unavailable with a
  reason; nothing is estimated silently, and nothing is seeded.
- Live automatic execution stays globally off. Stage 5 adds no path to enable it.
- Telemetry failures cannot interrupt the scanner, the queue, statistics or
  the evidence worker.
- Broker-derived, engine-derived and self-reported values stay visibly separate.

## Technical detail

New migration (single file, grants before RLS before policies):

- `account_telemetry_snapshots` — account_id, user_id, source
  (`metastats`), status (`ok` / `processing` / `unavailable`), reason,
  metrics jsonb, observed_at; owner-only SELECT, service_role full.
- `account_risk_trackers` — account_id, vendor tracker id, name, period,
  threshold kind/value, created_at, last_error.
- `account_risk_events` — account_id, tracker_id, broker event payload,
  event_at, unique on (tracker_id, event fingerprint) for idempotency.
- `telemetry_budget` — account_id + source lease row with `next_allowed_at`,
  used by a claim function (`claim_account_telemetry`, security definer) so a
  second run cannot double-spend the vendor budget.
- `connected_trading_accounts`: add `max_account_open_positions` and
  `max_account_exposure_note` for the exposure boundary.

New modules:

- `src/lib/telemetry/metastats.ts` — pure: normalise metrics, decide
  freshness, format "still calculating".
- `src/lib/telemetry/collect.server.ts` — bounded pass: claim budget, read
  metrics, write snapshot, halt on billing/permission refusal by parking the
  account rather than looping.
- `src/lib/telemetry/guardian.server.ts` — tracker ensure/read using the
  existing `riskGuardianAvailability` gate; unsupported accounts are skipped
  and recorded as unsupported.
- `src/lib/execution/exposure-account.ts` (pure) + wiring in
  `direct.server.ts` / `revalidate.server.ts` for the broker exposure gate.
- `src/routes/api/public/worker/telemetry.ts` — cron-authorised worker,
  fixed item cap per run, single-flight via the budget claim, paused-state
  guard, no chained self-invocation.
- pg_cron entry for the telemetry worker on its own schedule, separate from
  the scan and reconcile schedules.

UI: `src/routes/_authenticated/accounts.tsx` gains the telemetry, guardian and
evidence panels via new server functions in `src/lib/accounts.functions.ts`
(owner-scoped reads only). Admin benchmark summary is added as a panel under
the existing admin intelligence route.

Tests (all taxonomy-tagged, blocking):

- processing status never renders as zero or as loss
- unavailable telemetry never becomes a trading claim
- MT5 netting yields unsupported guardian with a reason
- budget claim prevents a second concurrent run and enforces the interval
- billing/permission refusal parks the job; the next run probes once
- exposure gate refuses on unreadable broker positions and on boundary breach
- evidence class separation: broker evidence never merges into self-reported
  journal statistics
- docs-contract additions for the new documented facts

Exit criteria: full suite green (812 existing + new), build OK, scanner and
heartbeat unchanged, live execution still globally off.
