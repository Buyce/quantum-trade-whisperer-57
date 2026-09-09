# Market intelligence: what rivals feed their engines, and what we should

Researched with sources. Answering your questions first:

- **MetaApi has no news or calendar.** It serves prices, ticks, symbol specs, orders
  and accounts — nothing else. But it *does* already give us tick-level bid/ask, so
  spread, tick volume and session liquidity are ours for free
  ([tick API](https://metaapi.cloud/docs/client/restApi/api/retrieveMarketData/readHistoricalTicks/)).
- **"Just ask ChatGPT" is the one thing we must not do.** We already have OpenAI's
  strongest models through Lovable AI, so there is no better brain to rent. But a
  model asked for "next week's CPI" answers from memory, and a confident wrong
  release time is worse than none. An AI may **read** a fetched source; it may never
  **be** the source.
- **FRED goes as a calendar, stays as a data feed.** It cannot give release times, so
  it is useless for news. It *is* the best free source for yields, rates and macro
  series ([FRED API](https://fred.stlouisfed.org/docs/api/fred/)) — which the
  intermarket work below needs.

## What competitors actually use, and what it is worth

| Data | What it costs us | Real edge for our scanner |
| --- | --- | --- |
| Economic calendar with exact times | Paid feed, ~subscription ([Trading Economics](https://tradingeconomics.com/api/calendar.aspx), [Finnhub](https://finnhub.io/pricing-economic-data-api)) | **High.** The only way news can ever gate an order. |
| Intermarket: dollar index, US yields, gold, oil, indices | Free ([FRED](https://fred.stlouisfed.org/series/dgs10)) | **High.** Best-evidenced cheap directional filter in FX. |
| Broker microstructure: spread, tick volume, session liquidity | Free, already in MetaApi | **High.** We already sample spread; extend it. |
| Session and time-of-day statistics | Free, our own history ([JoF 2024](https://onlinelibrary.wiley.com/doi/10.1111/jofi.13306)) | **High.** Strongest evidence, zero cost. |
| Positioning: CFTC Commitments of Traders | Free US government REST ([CFTC](https://publicreporting.cftc.gov/stories/s/Commitments-of-Traders/r4w3-av2u/)) | **Moderate.** Weekly and lagged — a slow bias filter, never a trigger. |
| Retail long/short sentiment (IG, Myfxbook) | Account-tied or paid; Myfxbook says historical isn't available by API | **Low/awkward.** Popular in marketing, hard to automate honestly. |
| Volatility regime (VIX) | Free CSV from CBOE | **Moderate.** Useful risk-on/off regime tag. |
| FX implied vol / risk reversals | Paid only, no clean free source | **Speculative.** Vendor-marketed; no public evidence of intraday edge. |
| News sentiment scoring | Free low tiers ([Marketaux](https://www.marketaux.com/pricing)) | **Unproven intraday.** Evidence sits at daily/macro horizons. |
| Scraped calendars (Forex Factory, Investing.com) | "Free" but against their terms, fragile | **Avoid as the primary.** Fallback only. |

Blunt conclusion: the biggest wins are cheap or free and we are not using them. The
expensive, heavily-marketed feeds (options skew, sentiment scores) are the ones with
the weakest evidence.

## The plan

### Phase 1 — Stop the dishonesty (no new vendor)

- Remove FRED as a news provider: delete the provider and its cron branch, retire
  `FRED_API_KEY`. Keep every news table, the ledger and the coverage model; existing
  rows are marked as coming from a retired provider, not deleted.
- Pin the news gate so it cannot refuse an order, and replace the dead blocking
  control in Settings with an honest statement. Five accounts currently have a switch
  on that does nothing.
- Re-instate the **Economic events** panel in Admin on the existing `get_admin_news`
  reader, showing last fetch, coverage per currency, and what was discarded and why.

### Phase 2 — Intermarket context (free, highest value per hour)

- New `market_context_series`: daily dollar-index proxy, US 2y/10y yields, gold, oil,
  a VIX regime tag — pulled from FRED and CBOE on a schedule, each value stamped with
  its source and observation date. A failed pull writes its ledger row and stores
  nothing; it never becomes a neutral reading.
- Stamp every published setup and research candidate with the context held at that
  moment: yield direction, dollar direction, whether the setup agrees with it, and the
  volatility regime.
- Admin comparison: resolved replay outcomes with the context aligned versus against,
  per instrument, with the same sample floors as the other panels. Below the floor it
  says "not yet measurable" instead of a number.

### Phase 3 — Positioning and session structure (free)

- Weekly CFTC positioning per currency, stored with its report date so its staleness
  is always visible, and stamped on setups as a slow bias tag.
- Extend the spread sampler we already run into a session-liquidity profile per
  instrument (spread and tick activity by hour), and stamp each setup with its
  session bucket and the spread percentile at capture.

### Phase 4 — A real calendar, once the above proves out

- A licensed calendar with exact release times, forecasts and impact, behind the
  existing provider-neutral interface. You approve the subscription; we keep the
  adapter swappable.
- Until then, an optional fetched-and-AI-read fallback: fetch a public calendar page,
  let the AI extract events, and store only events found word-for-word in the fetched
  text — anything else is discarded, a failed fetch stores nothing, and every event is
  labelled as a scraped, unofficial source.
- Only when exact times exist does news blocking become possible. Per your choice it
  still stays **warn only** until our own comparison shows an effect worth blocking on.

Across all phases: news and context **warn, never block**, and every new field is
recorded on setups so the learning engine can measure it. No gate changes without
evidence from our own resolved outcomes.

## Technical notes

- Migration: `market_context_series` and `positioning_snapshots` (service-role only,
  admin RPC reads); context columns on `scanned_signals` and `research_candidates`;
  pg_cron entries for the new pulls and for `purge_news_data()`.
- New providers live behind the existing `EconomicEventProvider`-style contract in
  `src/lib/news/`, so coverage, ledger and revision handling are reused, not rebuilt.
- Remove `src/lib/news/providers/fred.server.ts` and its FRED tests; `gate.server.ts`
  keeps recording verdicts with enforcement pinned off, `news_blackout` stays unused.
- `[INVARIANT]` tests: a failed pull stores no value and no healthy coverage; an
  AI-extracted event absent from the fetched text is never stored; a date-only event
  never claims a time; the gate never enforces; stale positioning always reports its
  report date; every comparison refuses to report under its sample floor.
- Docs: `docs/NEWS-AND-EVENTS.md` rewritten; a new `docs/MARKET-CONTEXT.md` for the
  intermarket, positioning and session layers; `docs/MCP.md` gains a
  `get_news_context` read tool.
