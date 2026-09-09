# Replace FRED with a scraped, AI-read economic calendar

Answering your questions first:

- **MetaApi cannot help.** Its API is prices, ticks, symbol specifications, orders
  and account management. There is no calendar or news endpoint anywhere in it, and
  its other products (CopyFactory, MetaStats) do not carry one. A calendar always
  comes from a separate source.
- **FRED is being removed.** It only knows US release *dates* — no clock time — and
  covers none of the EUR, GBP, JPY, AUD, CAD, CHF or energy risk your instruments
  actually trade on. It has not refreshed since 25 August and has never changed a
  single decision.
- **Yes, we can scrape with AI, with tools we already have.** Firecrawl (a scraping
  service available as a connector) fetches the public calendar page; Lovable AI
  reads it into structured events. No new vendor contract, no licence fee beyond
  Firecrawl's own usage.

Your earlier choices still hold: news **warns, never blocks**, and the event context
is recorded on every setup so the learning engine can measure it.

## 1. Remove FRED

- Delete the FRED provider, its cron job branch and its release map. Retire the
  `FRED_API_KEY` secret.
- Keep every news table, the provider-neutral interface, the coverage model and the
  ledger. Existing FRED rows are marked as coming from a retired provider rather
  than deleted, so history stays honest.

## 2. New provider: scrape + AI read

A single new provider behind the same interface, run on a schedule:

1. **Fetch** the public economic-calendar page for a date range with Firecrawl, as
   clean text.
2. **Read** that text with Lovable AI into a strict list of events: date, time and
   stated timezone, currency, impact, event name, forecast and previous where the
   page shows them.
3. **Verify before storing** — this is the part that keeps the zero-fabrication rule
   intact:
   - every event must be traceable to a line of the fetched page; anything the
     model produces that is not found in the source text is discarded, not stored;
   - dates and times must parse, be inside the requested window, and carry an
     explicit timezone, or the event is stored as date-only;
   - the run is rejected wholesale if the page did not load, the layout changed, or
     the extraction returns implausibly few or many events. A failed run writes its
     ledger row and produces no events — never a "clear calendar".
4. **Store** with provenance stamped as scraped-and-model-read, per field. Coverage
   per currency and family is computed from what actually arrived, so the currencies
   the page really covers become covered and the rest stay visibly uncovered.

Because these pages publish a clock time, events can finally carry an exact time —
which is what makes the whole layer meaningful.

Honest caveats stated in the app and the docs: a scraped page is a third-party,
unlicensed source that can change layout or block us, so its events are labelled
"scraped, not an official source", and a scrape failure never silently degrades into
"nothing scheduled". You will need to approve the Firecrawl connection once.

## 3. Make news visible — warn only

- **Signal card and feed:** a marker on setups whose instrument has a release
  inside a window around the setup, naming the event, its currency, impact and
  time, and labelled as a scraped source.
- **Alerts (push and email):** the same one-line marker when present.
- **Settings:** the dead blocking control is replaced by an honest statement that
  news is informational. The gate stays pinned so it can never refuse an order.
- **Admin → Intelligence:** re-instate the economic-events panel on the existing
  `get_admin_news` reader — last scrape, what parsed, what was discarded and why,
  coverage per currency, and the stored events with their precision inline.
- **Assistant (MCP):** a `get_news_context` read tool, stating plainly that news
  never blocks and that unknown coverage is not clearance.

## 4. Feed the learning engine

- Stamp each published setup and research candidate with the event context held at
  that moment: whether a release fell in its window, which currencies and families,
  the minutes to the event, and the coverage state.
- New Admin comparison: resolved replay outcomes with a news event nearby versus
  without, per instrument, with the same sample floors as the other panels. Below
  the floor it says "not yet measurable" instead of showing a number.
- Descriptive in-sample measurement only. It changes no gate. If it ever shows a
  real effect, turning news into a blocker becomes a separate, evidenced decision —
  and by then the data will support it.

## Technical notes

- Firecrawl connector linked to the project; scraping and AI extraction run
  server-side only, inside a cron handler, keys never reaching the browser.
- Extraction uses the AI SDK with a small flat schema and a source-line check on
  every field; the model is a reader, never a source. Long calls stream.
- Migration: pg_cron entries for the new ingestion and for `purge_news_data()`;
  event-context columns on `scanned_signals` and `research_candidates`; the
  event-day comparison function plus an admin RPC, service-role only.
- Removal: `src/lib/news/providers/fred.server.ts` and its tests; the cron route
  loses the FRED branch. `src/lib/news/gate.server.ts` keeps recording verdicts with
  enforcement pinned off; `news_blackout` stays in the vocabulary unused.
- `[INVARIANT]` tests: an event not present in the fetched source text is never
  stored; a failed or blocked scrape yields no events and no healthy coverage; a
  date-only event never claims a time; the gate never enforces; a marker never
  appears without a held event; the comparison refuses to report under its floor.
- Docs: `docs/NEWS-AND-EVENTS.md` rewritten for the scraped source, warn-only status
  and its limits; `docs/MCP.md` gains the new tool.
