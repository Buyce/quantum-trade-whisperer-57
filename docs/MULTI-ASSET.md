# Multi-asset (Wave 2)

Wave 2 admits four instruments from three asset classes P-Trades had never
handled: `XAGUSD` (precious metal), `USOIL` and `UKOIL` (energy CFDs) and
`NAS100` (index CFD).

All four are at stage `disabled`. They are definitions and infrastructure, not
products. Nothing scans, measures, publishes, alerts or executes them.

## Asset classes

Every registry entry now carries an `assetClass` and a `priceUnit`. Those two
fields select the market calendar, the reporting unit, the sizing route and the
strategy manifest.

| Asset class | Instruments                        | Reporting unit |
| ----------- | ---------------------------------- | -------------- |
| `fx`        | EURUSD, GBPAUD + the Wave 1 pairs  | pips           |
| `metal`     | XAUUSD, XAGUSD                     | price units    |
| `energy`    | USOIL, UKOIL                       | price units    |
| `index`     | NAS100                             | index points   |

## The pip rule is dead outside FX

"One pip is ten points" is an FX decimal convention. `src/lib/instruments/price-units.ts`
reports a distance in price units, broker points, broker ticks and spread-to-ATR,
and reports pips **only** for `fx`. An index reports index points and never a pip.

Every unit is derived from the broker's own `point`/`tickSize`. When the broker
unit is unknown the answer is `null` with a stated refusal — never a default of 1.

## Contract geometry is a broker fact

Wave 2 definitions carry `contractSize: null`, `lotStep: null`, `minLot: null` and
`spreadFloor: null`. Contract size for a metal, an oil CFD or an index varies
between brokers by orders of magnitude, so `contractSpecs()` omits these
instruments entirely and sizing refuses rather than mis-sizes.

## Versioned market calendars

`src/lib/instruments/calendars.ts` holds one versioned calendar per asset class:
session boundaries, a daily maintenance break, weekly closure, recorded holidays,
the venue timezone and an explicit DST policy. The version is recorded alongside
the binding in `instrument_calendar_bindings`, so stored evidence can always be
re-read against the boundaries that judged it.

- `fx_spot` and `metal_spot` v1 reproduce the existing Friday 21:00 / Sunday 21:00
  UTC week exactly. Wave 0 behaviour is unchanged.
- `energy_cfd` and `us_index_cfd` v1 are marked `venue_local` and are therefore
  **not usable** for measurement: their UTC boundaries move with DST and have not
  been sourced from the broker. The sampler refuses those instruments and records
  the refusal instead of approximating a session.

A closed market is reported as `closed_weekend`, `closed_holiday` or
`closed_break` — never as a provider failure. A quote whose broker timestamp
predates the current open window is stale by construction and is refused, so a
price carried across a break cannot become evidence.

## Broker symbol discovery, fail-closed

A broker may call silver `XAGUSD.r`, WTI `USOIL`, `WTI`, `XTIUSD` or `CL-OIL`, and
the tech index `NAS100`, `US100` or `USTEC`. `discovery.server.ts` asks the
provider for its real inventory, considers only accepted patterns, and records the
result in `instrument_alias_discovery`:

| Outcome               | Meaning                                                        |
| --------------------- | -------------------------------------------------------------- |
| `candidate`           | exactly one instrument, with a complete usable specification    |
| `ambiguous`           | two or more distinct tickers matched; an operator must choose   |
| `missing`             | the broker exposes nothing matching                             |
| `spec_unusable`       | partial geometry, or a settlement currency we did not plan for   |
| `trade_mode_unusable` | broker reports the symbol close-only or disabled                |
| `error`               | the provider call failed                                        |

Discovery never writes a mapping. A candidate is evidence for an operator
decision, not an activation.

## Capacity

`src/lib/telemetry/capacity-projection.ts` prices an activation before it happens:
sampler quotes, candle reads, the daily specification refresh, conversion-leg
quotes and readiness snapshots, per instrument per day. Activation is refused
unless the projection fits inside the daily budget with a retry reserve. Wave 2
may never crowd out Wave 0.

## Correlation and news risk

`XAUUSD`+`XAGUSD` (`metals_usd`), `USOIL`+`UKOIL` (`energy`) and `NAS100`
(`index_risk`) are correlation groups. Advisory exposure counts a group as one
exposure; no correlation coefficient is claimed, because none has been measured.

News-risk families are recorded per instrument — central bank/inflation/employment
for FX and metals, EIA inventories and OPEC supply for energy, US macro and
earnings season for the index. With no event source covering a family, coverage is
**unknown**, and unknown suppresses new entries rather than clearing them.

## Strategy portability

`src/lib/scanner/manifests/asset-strategy.ts` records, per asset class, whether
each V1/V2/V3 assumption is `verified`, `unverified` or `invalid`. `fx` and `metal`
are verified because they describe what production already does. `energy` and
`index` carry `invalid` entries for stop buffer, entry offset and gap handling, so
neither may run strategy code. The manifests are defined and tested; they are
wired to nothing until an instrument legitimately reaches `shadow`.

## Disposition

| Instrument | Stage      | Blocker                                                                     |
| ---------- | ---------- | --------------------------------------------------------------------------- |
| XAGUSD     | `disabled` | no broker mapping or specification; no measured spread floor                 |
| USOIL      | `disabled` | as above, plus an unsourced venue-local calendar and invalid strategy assumptions |
| UKOIL      | `disabled` | as above                                                                     |
| NAS100     | `disabled` | as above                                                                     |

Wave 1 has not yet passed its own evidence checkpoint, so no Wave 2 promotion is
even eligible for consideration. The first `disabled → data_validation` decision
follows that review, and each instrument then needs its own completed trading days
of evidence before a shadow gate is discussed.

## Tests

`src/lib/instruments/__tests__/wave2-multi-asset.test.ts` pins the refusals: no pip
for a non-FX instrument, no contract size without the broker, ambiguous and missing
aliases refused, partial specifications refused, closed-market and carried-quote
staleness, capacity headroom, correlation grouping, unknown news coverage
suppressing, and Wave 0 remaining exactly the scan universe and the settings list.
