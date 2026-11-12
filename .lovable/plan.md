# Connect CME futures data (Databento, daily) to shadow research

## What already exists
- COT positioning already uses real weekly CFTC public reports (no key needed). Nothing changes there.
- Missing: real exchange futures volume and open interest. This plan adds that from Databento.

## What you'll get
- Daily CME settlement data (volume, open interest, settlement price) for the futures matching our instruments: 6E (EURUSD), 6B (GBPUSD), 6J (USDJPY), 6A (AUDUSD), 6C (USDCAD), 6S (USDCHF), GC (XAUUSD), NQ (NAS100). GBPAUD has no direct contract and is left out.
- Used only by shadow research and the Admin Market Context panel. It never feeds live grading, sizing or order decisions.
- Every row is labelled "Databento / CME", with the trade date. A missing day shows as missing, never estimated.

## Setup step for you
- Create a Databento account and API key (pay-as-you-go; daily data for 8 contracts costs very little). You'll get a secure card to paste it in; it's never shown in chat.

## Technical details
- Credential: Databento custom connector (Basic auth, key as username) if available, otherwise secret `DATABENTO_API_KEY`.
- Table `futures_daily` (symbol, root, trade_date, volume, open_interest, settlement, source='databento', dataset='GLBX.MDP3', fetched_at); unique (root, trade_date); RLS admin-read, service-role write; grants.
- `src/lib/context/futures.server.ts`: one Timeseries request per run (schema `statistics` + `ohlcv-1d`, continuous front-month `stype_in=continuous`, e.g. `6E.c.0`), 20s abort timeout, bounded lookback (5 days incremental, 365 on first backfill), fail-closed: errors logged via describeError and recorded as a failed source, no partial invent.
- Hook into existing `ingest-market-context` cron (daily after CME settlement ~22:30 UTC), reporting status like the CFTC source; unreadable → non-2xx.
- Shadow research: add features `fut_volume_z20`, `fut_oi_change_5d`, joined to COT net positioning, available only to research candidates/shadow cohorts; absent data → feature null, candidate excluded from that feature's tests.
- Admin MarketContextPanel: futures freshness + last trade date per root.
- Tests: parser on recorded Databento response shape, missing-day stays null, timeout → failed source, invariant that live eligibility/sizing modules don't import futures module.
