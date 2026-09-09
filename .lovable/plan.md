# News awareness: make it honest, visible and measured

Your choices: free official sources only, news never blocks an order, and event
context feeds the learning engine.

MetaApi does not answer this. Its API is prices, ticks, symbol specs, order
execution and account management — there is no calendar or news endpoint in it,
and its other products (CopyFactory, MetaStats) do not carry one either. So no,
we cannot get news from the connection we already pay for; a calendar always
comes from a separate source. Free official sources only have dates, which is
why the plan below keeps news as a warning, never a blocker.

That combination is coherent, and it fixes the real problem. Today the news layer
is invisible and inert; nobody can see it, and five accounts have a blocking
switch on that has never once refused anything. After this work news becomes a
labelled warning you can see everywhere, plus a fact recorded on every setup so
the replay engine can eventually tell you whether event days actually trade worse
— instead of a convention we assert.

## What the audit found (verified against live data)

- The calendar last refreshed on 25 August. There is no scheduled news job at
  all, and only 4 fetch attempts have ever happened.
- 46 events held, **none with a release time** — dates only. Coverage for XAUUSD,
  GBPAUD and EURUSD reads `unsupported`.
- The news check runs on every automatic order (16,404 evaluations, the latest
  minutes ago) and every one ends "would suppress, not enforced". Zero orders have
  ever been refused for news.
- Nothing about news appears on a signal card, in Settings, in Admin, or in the
  assistant tools. The Admin reader `get_admin_news` exists but no screen uses it,
  and `docs/NEWS-AND-EVENTS.md` still claims that panel is there.

## 1. Repair the feed (it must actually refresh)

- Schedule `/api/public/cron/ingest-news` on pg_cron, twice daily, with the
  existing cron secret. Every attempt keeps writing its ledger row, so "we tried
  and were refused" stays visible.
- Purge job `purge_news_data()` gets scheduled alongside it.
- Nothing about precision changes: a date-only schedule stays date-only. No
  conventional release time is ever invented.

## 2. Make news visible — warn only, never block

- **Signal card and feed:** a plain marker on setups whose instrument has a
  scheduled release **on that calendar day**, naming the event and stating the
  time is unknown. Worded as "scheduled risk today", never as a forecast.
- **Alerts (push and email):** the same one-line marker when present.
- **Settings:** the blocking control is retired from the screen and replaced by an
  honest statement that news is informational because no free official source
  publishes exact release times. The database columns stay for compatibility, and
  the gate is pinned so it can never enforce.
- **Admin → Intelligence:** re-instate the economic-events panel on the existing
  `get_admin_news` reader — provider runs, coverage per scope, stored events with
  their precision inline, and last refresh time.
- **Assistant (MCP):** a `get_news_context` read tool returning held events and
  coverage for an instrument, explicitly stating that unknown coverage is not
  clearance and that news never blocks.

## 3. Feed the learning engine

- At publication, stamp each setup with the event context we actually hold: was
  there a release scheduled that day for its currencies and families, which event
  families, and the coverage state at that moment. Mirrored onto research
  candidates so rejected structures carry it too.
- A new Admin comparison — resolved replay outcomes on event days versus other
  days, per instrument, with sample sizes and the same statistical floors the
  other panels use. Under the floor it says "not yet measurable" rather than
  showing a number.
- This is descriptive in-sample measurement, not a forecast, and it changes no
  gate. If it ever shows a real effect, tightening a gate becomes a separate,
  evidenced decision.

## What this does not do

- No commercial or scraped calendar, so **no timed blackout window is possible**
  and news cannot hold an order. That is the direct consequence of the free-source
  choice, and the copy says so plainly rather than implying protection.
- Non-USD releases (EUR, GBP, JPY, AUD, CAD, CHF), energy inventories, OPEC and
  index earnings remain uncovered and are labelled uncovered, never clear.
- Nothing already at your broker is ever touched.

## Technical notes

- Migration: pg_cron entries for news ingestion and purge; event-context columns
  on `scanned_signals` and `research_candidates`; a stats function and reader for
  the event-day comparison, service-role only with an admin RPC.
- `src/lib/news/gate.server.ts` keeps evaluating and recording to
  `news_policy_evaluations`, with enforcement pinned off; `news_blackout` stays in
  the refusal vocabulary unused rather than being deleted.
- New: a shared day-level context helper reused by the scanner stamp, the signal
  card, alerts and the MCP tool, so one definition serves all four.
- `[INVARIANT]` tests: a date-only event never opens a timed window; the gate never
  enforces; an unreadable news table produces no marker and no "clear" claim; a
  day marker never appears without a held event; the event-day comparison refuses
  to report under its sample floor.
- Docs: `docs/NEWS-AND-EVENTS.md` corrected (panel, schedule, warn-only status) and
  `docs/MCP.md` gains the new tool.
