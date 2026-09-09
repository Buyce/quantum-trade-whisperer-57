# Economic events (news)

P-Trades' news layer answers one question honestly: **can we see the scheduled
risk for this instrument right now?** Today the honest answer is *no*, and the
system says so rather than pretending otherwise.

## Current state: no calendar provider, no enforcement

FRED was **retired as a calendar provider** (2026-09-09). It published release
*dates* with no intraday release time, covered almost nothing outside USD, and
so could never authorise an intraday suppression: in its whole life it changed
zero orders. Keeping it running only produced `timestamp_incomplete` coverage
that looked like a feature.

As a result:

- `/api/public/cron/ingest-news` ingests **nothing** and claims **no coverage**.
  It writes no events and no coverage rows, so an empty calendar can never be
  read as a clear one. Its schedule is stopped.
- News suppression is **pinned off** (`NEWS_ENFORCEMENT_PINNED_OFF` in
  `src/lib/news/gate.server.ts`, gate version `news-gate-2`). The verdict is
  still computed and written at both execution boundaries, so the effect of a
  real calendar can be measured before it is ever allowed to refuse an order.
- The provider-neutral contract in `src/lib/news/types.ts` and the ingestion
  runtime are untouched, so a licensed exact-time calendar plugs straight in.

Macro *context* — the dollar, US yields, volatility, futures positioning — is a
different thing and is live: see [MARKET-CONTEXT.md](MARKET-CONTEXT.md).

Deliberately absent, and never inferred:

- **Energy inventories** (no valid EIA credential) — `energy_inventory` stays
  `unsupported`, so USOIL / UKOIL fail closed wherever it is required.
- **OPEC** has no machine-readable announcement feed — `opec_supply` is
  `unsupported`.
- **Non-USD currencies** (EUR, GBP, JPY, AUD, CAD, CHF) are `unsupported`, so
  GBPUSD's GBP-side risk is visibly uncovered rather than inherited.
- **Equity earnings calendars** for NAS100 are not sourced.
- Commercial scrapers (Forex Factory, Investing.com and similar) are not used.

## Coverage, not a health flag

There is no global `news_healthy` boolean anywhere in the system, because no single
flag would be truthful. Coverage is measured per **(provider, currency, event
family)** and stored in `news_coverage_snapshots`:

| State                          | Meaning                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `healthy`                      | Provider answered completely and every event carries an exact release time. Only this state can clear a new entry. |
| `timestamp_incomplete`         | The schedule is real, but release times are date-only — it cannot authorise an intraday suppression window.        |
| `partial`                      | Some pages/series answered, others did not.                                                                        |
| `stale`                        | The provider's own data is older than required.                                                                    |
| `provider_error`               | Outage, throttle, rejected credential, or a schema mismatch.                                                       |
| `unsupported`                  | The provider structurally has no data for this scope.                                                              |
| `unknown` (`unproven` in code) | Never successfully observed.                                                                                       |

Rules that hold by construction, and are covered by tests:

- A failed fetch can **never** produce `healthy` coverage.
- An empty window is `healthy` only when the provider itself answered completely;
  a throttled empty response is `provider_error`, not "nothing scheduled".
- Date-only schedules downgrade the scope; they never upgrade it.
- Worst-of merging across scopes — one defective scope cannot be averaged away.

## Policy: dark by default, unknown suppresses

`evaluateNewsPolicy` (pure, versioned as `news-policy-1`) always computes two
separate things:

1. **`wouldSuppressNewEntries`** — the verdict on the data.
2. **`enforced`** — whether that verdict is applied, which is true only in
   `enforcing` mode.

Wave 0 (XAUUSD, GBPAUD, EURUSD) runs in **comparison mode**: verdicts are recorded
in `news_policy_evaluations` and never applied, so an incomplete calendar cannot
change behaviour that is already live. An instrument moves to `enforcing` only once
its required scopes are proven `healthy`.

Suppression windows apply **only** to events with an exact time:

| Importance | Before | After  |
| ---------- | ------ | ------ |
| high       | 60 min | 30 min |
| medium     | 30 min | 15 min |
| low        | none   | none   |

Refusal reasons are explicit: `no_news_profile`, `coverage_incomplete`,
`release_time_unknown`, `event_window`. Unknown coverage is **not** clearance.

## Ingestion

`/api/public/cron/ingest-news` (cron-secret authorised) is the ingestion entry
point. With no provider configured it returns an empty provider list and writes
nothing at all. The behaviour below describes the contract a future licensed
provider will run under; every attempt writes exactly one row per attempt to
`news_ingestion_runs` — even when the provider fails, because "we tried and were
refused" is the fact that keeps coverage honest. An absent run row must never
look like an empty calendar.

Writes are idempotent on `(provider, provider_event_key)`:

- unseen key → insert plus revision 0
- identical checksum → duplicate, nothing written
- changed checksum → `revision N+1` plus an append-only `economic_event_revisions`
  row classified as `schedule_change`, `value_revision`, `status_change`,
  `postponed`, `cancelled` or `republished`

Identity comes from stable provider ids, never a mutable title, so a provider
renaming "CPI" to "Consumer Price Index" cannot create a second event.

A per-provider breaker derived from the ledger (5 consecutive failed runs inside 30
minutes) skips a provider rather than hammering it. Providers are independent: one provider
failing never suppresses or substitutes another.

## Credentials

No calendar credential is in use. The ingestion runtime still routes every log
line, error note and ledger row through `redactUrl` / `safeNote`, because some
calendar providers accept the key only as a query parameter, which makes the
request URL itself a secret. No credential ever appears in the database, the
admin panel, or any response.

`FRED_API_KEY` remains in use for **market context** series only (see
[MARKET-CONTEXT.md](MARKET-CONTEXT.md)), not for events.

## Where to look

- Admin → Intelligence → **Economic events**: provider health from the run ledger,
  coverage per scope, stored events with their precision stated inline, latest runs,
  and the dark policy comparisons.
- Tables: `economic_events`, `economic_event_revisions`, `news_ingestion_runs`,
  `news_coverage_snapshots`, `news_policy_evaluations` (all service-role only;
  admin reads go through `get_admin_news()`).
- Retention: `purge_news_data()` — events 400 days, runs and coverage 90 days,
  evaluations 180 days.

## Why no exact release times (official-source survey, 2026-08-25)

A survey of official sources — Fed/FOMC, BLS, BEA, US Census, ECB, BoE, BoC,
StatCan, RBA, ABS, SNB, Swiss FSO, BoJ, e-Stat, EIA, OPEC, Nasdaq and NYSE —
found that **no free official source publishes a structured (JSON/ICS) forward
calendar combining event, country, exact time and timezone**. Release times are
either conventions stated in prose (BLS/Census 8:30am ET, EIA WPSR Wed 10:30am ET)
or times printed in HTML tables, never a machine-readable field. The EIA Weekly
Petroleum Status Report schedule, including its holiday shifts, exists only as an
HTML table; OPEC publishes no announcement feed or API at all. Consensus/forecast
values do not exist in official data by definition.

That is the reason this system stores events as `date_only` and refuses to open a
timed suppression window from them, rather than assuming a conventional time.
Closing the gap requires either an official structured feed appearing, or an
explicit decision to ingest a licensed commercial calendar — not an inferred time.

## The execution news gate (`src/lib/news/gate.server.ts`)

The pure policy is now consulted at two execution boundaries: automatic enqueue
(`execution_enqueue`) and immediately before the broker submission is assembled
(`broker_submission`). Every consultation is written to
`news_policy_evaluations`, whether or not it changed anything.

Enforcement is currently **pinned off**: no news verdict can refuse an order,
whatever the settings say. The conditions below are what enforcement will require
when a real exact-time calendar exists, and they remain in force underneath the
pin — enforcement can only ever REFUSE an order, never create or enlarge one:

- The owner must have news blocking on (`scanner_settings.news_block_new_entries`),
  with their own window width (`news_suppression_minutes_before` / `_after`,
  applied to `high` and `unknown` importance only).
- The verdict must name at least one real calendar event that P-Trades holds.
- A verdict resting only on INCOMPLETE COVERAGE is recorded as
  `would_suppress` and is not enforced: refusing every order because a feed is
  unproven would be a market claim manufactured out of missing data. Such
  verdicts become enforceable once coverage for the instrument's
  currency × family scopes is proven healthy.
- An unreadable news table yields no events and no coverage, so it can never
  invent a refusal and never reports coverage as healthy.

A refusal surfaces as `news_blackout` in the automatic-order decision ledger and
in the delivery rejection vocabulary. It is treated as a MOMENT, not a judgement
on the setup: once the window passes, the same setup may be re-asked while the
owner's automatic-order window is still open.
