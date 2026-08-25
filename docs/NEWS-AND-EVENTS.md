# Live economic events (news)

P-Trades' news layer answers one question honestly: **can we see the scheduled
risk for this instrument right now?** Everything below exists to stop a partial
calendar from being mistaken for a clear one.

## Sources

| Provider | What it proves | What it cannot prove |
| --- | --- | --- |
| **FRED** (St. Louis Fed) | Which US statistical releases exist (stable numeric release ids) and which **calendar dates** they are scheduled for, including future dates. | The intraday release **time**. `/fred/releases/dates` returns a bare date, so no exact instant exists. Actual/forecast/previous values are not requested by the adapter. |
| **EIA** v2 | Weekly US petroleum stock **published values**, keyed by week-ending period. | The Weekly Petroleum Status Report **publication schedule**, including holiday-adjusted release times — it is not served by the API. No forward EIA event is ever emitted. |

Deliberately absent:

- **OPEC** has no machine-readable announcement feed, so `opec_supply` is declared
  `unsupported`. It is never silently treated as covered.
- **Non-USD currencies** (EUR, GBP, JPY, AUD, CAD, CHF) are declared `unsupported`
  by both providers. GBPUSD's GBP-side risk is therefore visibly uncovered rather
  than inherited from the USD side.
- **Equity earnings calendars** for NAS100 are not sourced.
- Commercial scrapers (Forex Factory, Investing.com and similar) are not used.

## Coverage, not a health flag

There is no global `news_healthy` boolean anywhere in the system, because no single
flag would be truthful. Coverage is measured per **(provider, currency, event
family)** and stored in `news_coverage_snapshots`:

| State | Meaning |
| --- | --- |
| `healthy` | Provider answered completely and every event carries an exact release time. Only this state can clear a new entry. |
| `timestamp_incomplete` | The schedule is real, but release times are date-only — it cannot authorise an intraday suppression window. |
| `partial` | Some pages/series answered, others did not. |
| `stale` | The provider's own data is older than required. |
| `provider_error` | Outage, throttle, rejected credential, or a schema mismatch. |
| `unsupported` | The provider structurally has no data for this scope. |
| `unknown` (`unproven` in code) | Never successfully observed. |

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

| Importance | Before | After |
| --- | --- | --- |
| high | 60 min | 30 min |
| medium | 30 min | 15 min |
| low | none | none |

Refusal reasons are explicit: `no_news_profile`, `coverage_incomplete`,
`release_time_unknown`, `event_window`. Unknown coverage is **not** clearance.

## Ingestion

`/api/public/cron/ingest-news` (cron-secret authorised) runs each provider over its
own window and writes exactly one row per attempt to `news_ingestion_runs` — even
when the provider fails, because "we tried and were refused" is the fact that keeps
coverage honest. An absent run row must never look like an empty calendar.

Writes are idempotent on `(provider, provider_event_key)`:

- unseen key → insert plus revision 0
- identical checksum → duplicate, nothing written
- changed checksum → `revision N+1` plus an append-only `economic_event_revisions`
  row classified as `schedule_change`, `value_revision`, `status_change`,
  `postponed`, `cancelled` or `republished`

Identity comes from stable provider ids, never a mutable title, so a provider
renaming "CPI" to "Consumer Price Index" cannot create a second event.

A per-provider breaker derived from the ledger (5 consecutive failed runs inside 30
minutes) skips a provider rather than hammering it. Providers are independent: an
EIA credential failure never stops FRED.

## Credentials

`FRED_API_KEY` and `EIA_API_KEY` are backend secrets read inside handlers only.
Both APIs accept the key **only as a query parameter**, which makes the request URL
itself a secret — so every log line, error note and ledger row goes through
`redactUrl` / `safeNote` first. No credential appears in the database, the admin
panel, or any response.

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
