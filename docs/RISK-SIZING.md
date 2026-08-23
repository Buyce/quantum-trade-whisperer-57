# Risk and position sizing

## Purpose

Convert a published trade plan plus the user's own risk profile into a lot size,
a cash-risk figure and a margin estimate — or refuse, naming the missing input.

## Current behaviour

Risk profile fields (`DEFAULT_RISK_PROFILE`): account equity (default `0`, i.e.
unset), account currency (USD/EUR/GBP/AUD), risk per trade percent (default `1`),
maximum position size (`0` disables the lot ceiling), leverage (default `100`),
maximum stop-loss percent (`0` disables the check).

Contract specifications (`CONTRACT_SPECS`): `XAUUSD` 100 oz/lot quoted in USD;
`EURUSD` 100 000 EUR/lot in USD; `GBPAUD` 100 000 GBP/lot quoted in **AUD**, so a
USD account needs an AUDUSD rate to convert the risk.

### Two sizing models, one authority

| Model   | Spec source                                | Status                             |
| ------- | ------------------------------------------ | ---------------------------------- |
| Model 1 | `static_v1` static contract specifications | **Authoritative**                  |
| Model 2 | Broker symbol specs refreshed daily        | Shadow only, logged for divergence |

Both run; disagreements are recorded in the sizing divergence log. The
authoritative `specSource` remains `static_v1` while Model 1 is active. Promotion
is service-role only and has not occurred.

Broker specs, when present, contribute the stops-level check: a stop closer to
entry than `stopsLevel × point` is refused with `below_stops_level`.

### Sizing service

`src/lib/sizing/service.server.ts` is the single implementation used by both the
terminal and the MCP `calculate_position_size` tool, so a user and their assistant
can never be told two different sizes.

FX conversion is **demand-driven**: a rate is fetched only when a specific
calculation needs one, only for allow-listed symbols, and the quote's **source**
timestamp (not its receipt time) must be fresh. A missing or unparseable source
timestamp counts as stale.

### High-risk acknowledgement

A risk-per-trade above 2% requires a persisted acknowledgement
(`risk_ack_high`). The invariant is enforced at the database layer as well as in
the web UI and the MCP tool, so it cannot be bypassed by a different client.
Sensitive risk fields additionally require `confirm_risk_change=true` when changed
through an assistant.

### Advisory exposure

Open-position, pending-order and daily-loss exposure figures are computed **from
the trades the user logged**, using `r_vs_plan` only. By default they are advisory
and do not block anything. A logged-trades-based execution limit blocks only after
an explicit opt-in (`exposure_limit_enabled`), and the wording always states that
it is based solely on trades the user logged. A missing journal record is never
treated as proof of zero broker exposure.

## Inputs

Planned entry, planned stop, instrument, the user's risk profile, a contract or
broker spec, and (only when the quote currency differs from the account currency)
a fresh FX quote.

## Outputs

Lots (rounded to `lotStep`, floored at `minLot`), cash at risk in the account
currency, a margin **estimate**, and flags: below minimum lot, exceeds margin,
exceeds the stop ceiling.

## Provenance

Equity, risk %, leverage and currency are **self-reported**. Specs are `static_v1`
or broker-supplied and labelled. Margin is an **estimate** derived from the model
and the stated leverage.

## Failure behaviour

No number is invented. Each refusal has a user-visible reason
(`RISK_UNAVAILABLE_COPY`):

| Reason               | Shown as                                                |
| -------------------- | ------------------------------------------------------- |
| `no_equity`          | Add your account balance in Settings → Risk             |
| `no_spec`            | No contract specification for this instrument           |
| `no_conversion_rate` | Live FX rate needed for conversion is unavailable       |
| `invalid_stop`       | This setup has no usable stop distance                  |
| `below_stops_level`  | Stop is closer than your broker's minimum stop distance |
| `stale_quote`        | The live quote is too old to size safely                |
| `stale_spec`         | The broker's contract specification is out of date      |

## User-facing meaning

"This is the size that risks the percentage you configured, given the plan's stop
distance." Nothing more.

## What sizing does not guarantee

- It cannot read your broker equity, open positions, free margin or commission
  schedule.
- The margin figure is not a broker-authoritative margin quote.
- It does not account for slippage beyond the plan's maximum acceptable entry.

## Implementation

`src/lib/risk.ts`, `src/lib/sizing/service.server.ts`, `conversion.server.ts`,
`portfolio.ts`, `src/lib/broker/specs.ts`, `specs.server.ts`, `sizing.server.ts`,
`sizing-compare.ts`, `src/lib/sizing.functions.ts`.

## Tests

`src/lib/__tests__/risk.test.ts`, `src/lib/sizing/__tests__/*`,
`src/lib/broker/__tests__/*`.
