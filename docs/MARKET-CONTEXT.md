# Market context (intermarket, volatility, positioning)

Market context answers a narrower question than the event calendar: **what was
the wider market doing when this setup was published?** It is recorded so its
effect can be measured. It changes nothing today — no order is held, resized,
reordered or refused because of it.

## Sources

| Source                        | Series                                                            | Cadence                        | Access                     |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------ | -------------------------- |
| **FRED** (St. Louis Fed)      | Broad trade-weighted US dollar index, US 2y and 10y yields, WTI    | Daily, published with a lag    | Free REST, `FRED_API_KEY`  |
| **CBOE**                      | VIX daily close                                                   | Daily                          | Free public CSV            |
| **CFTC** public reporting     | Commitments of Traders, non-commercial long/short by currency      | Weekly (Tuesday, out Friday)   | Free public REST (SODA)    |

Deliberately absent:

- **Gold** — FRED serves no daily USD gold series we may read, and the broker
  feed already carries real gold prices. No proxy is substituted.
- **FX implied volatility / risk reversals** — no reputable free feed exists;
  paid feeds are not purchased on a hunch.
- **News sentiment scoring** — evidence for intraday edge is weak, and it would
  require a licensed feed.

MetaApi is not a context source: it supplies broker prices, ticks and symbol
specifications, and publishes no calendar or macro data.

## Labels derived (`src/lib/context/derive.ts`, pure)

| Label                   | How it is decided                                                          |
| ----------------------- | -------------------------------------------------------------------------- |
| `ctx_dollar_direction`  | Dollar index over its two newest observations; inside ±0.15% it is `flat`   |
| `ctx_yield_direction`   | Same rule on the US 10-year yield                                          |
| `ctx_vol_regime`        | Latest VIX: `calm` < 15, `normal`, `stressed` ≥ 25                         |
| `ctx_alignment`         | Whether the setup's direction agrees with the dollar move for that pair     |
| `ctx_positioning_bias`  | Sign of non-commercial net contracts for the pair's non-dollar leg          |

The rule the whole module exists to enforce: **missing data is never neutral.**
One observation cannot show a direction, so it yields `null`, not `flat`. No VIX
reading yields `null`, not `calm`. A cross with no dollar leg (GBPAUD) or an index
(USTEC) yields `null` alignment rather than a guess. A failed read stamps nothing.

## Ingestion and the ledger

`/api/public/cron/ingest-market-context` (cron-secret authorised, daily 04:25
UTC) runs the three jobs independently — one failure never blocks another — and
writes one `market_context_runs` row per job whatever the outcome, with the
status vocabulary `ok`, `empty`, `partial`, `outage`, `authorization_error`,
`invalid_response`, `throttled`. Values are upserted on their natural key, so a
re-run cannot double-count. FRED's missing marker (`.`) is skipped, never coerced
to a number, and nothing is interpolated or carried forward.

Tables (all service-role only; owner reads go through `get_admin_market_context()`):

- `market_context_series` — one row per (series, observation date), source stamped
- `positioning_snapshots` — one row per (currency, report date, source)
- `market_context_runs` — every fetch attempt, including failures

## Where it is stamped

`readContextStamp` (`src/lib/context/stamp.server.ts`) is read immediately before
publication and stamps the labels onto `scanned_signals` (and research
candidates). It is advisory: the scanner never branches on the result, and a read
failure is logged and ignored rather than delaying or altering publication.
Readings older than 10 days are history, not context, and are not used.

## Where to look

Admin → Intelligence → **Market context**: the readings actually held with the
date the source published them, weekly positioning with its report date so the
lag is visible, every fetch attempt including failures, and replay outcomes split
by "with the dollar" versus "against it".

That split stays descriptive. Small samples prove nothing, and no context label
will be allowed to influence grading, ranking or execution until a cohort clears
the same validation floors every other learning claim must clear.
