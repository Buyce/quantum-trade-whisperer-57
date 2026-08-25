# Data provenance

## Purpose

Say, for every class of number the terminal shows, exactly where it came from.
If a value is not in this map, treat it as unproven.

## Provenance classes

| Class                    | Meaning                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| **broker-derived**       | computed from OHLCV candles fetched from MetaApi                               |
| **engine-derived**       | computed by this codebase from broker-derived inputs                           |
| **self-reported**        | typed in by the user or their assistant; unverified against any broker         |
| **broker evidence**      | account/deal facts returned by the connected broker and positively associated  |
| **controlled benchmark** | broker evidence from the dedicated P-Trades demo benchmark policy              |
| **replay-derived**       | produced by deterministic replay over stored candles; no order was ever placed |
| **estimate**             | model output that depends on assumptions and is labelled as such               |

## Field map

### Signals

| Field                                                   | Class                               |
| ------------------------------------------------------- | ----------------------------------- |
| candle OHLCV, ATR, EMA, RSI                             | broker-derived                      |
| bias per timeframe, Point C, order block, pillar scores | engine-derived                      |
| grade, confidence score and its components              | engine-derived                      |
| entry, stop, TP1/TP2/TP3, R multiples, `maxR`, `capped` | engine-derived                      |
| `maxAcceptableEntry`, TIF                               | engine-derived                      |
| qualitative breakdown                                   | engine-derived prose over the above |
| trading session, volatility regime                      | engine-derived (frozen definitions) |

Confidence is a **rule-satisfaction score, not a win probability**.

### Risk and sizing

| Field                                                                        | Class                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| account equity, risk %, leverage, account currency, max position, max stop % | self-reported                                            |
| `equity_as_of`                                                               | self-reported timestamp of the above                     |
| contract spec (`static_v1`)                                                  | engine-configured constant                               |
| broker symbol spec (Model 2)                                                 | broker-derived, shadow only                              |
| FX conversion rate                                                           | broker-derived, with a source timestamp; stale ⇒ refusal |
| lots, cash at risk                                                           | engine-derived from self-reported inputs                 |
| margin required                                                              | **estimate**                                             |
| exposure / daily loss advisory                                               | derived from **logged trades only**                      |
| connected-account equity, free margin, leverage and account type             | broker evidence with observation time                    |
| direct connected-account quantity                                            | engine-derived from fresh broker equity and account spec |
| connected-account open-position boundary check                               | broker evidence at submission time                       |

### Journal

| Field                                                      | Class                                               |
| ---------------------------------------------------------- | --------------------------------------------------- |
| decision (Taken / Skipped)                                 | self-reported                                       |
| snapshotted planned entry, stop, direction, grade, session | engine-derived, frozen at first creation            |
| actual entry, exit, initial stop                           | self-reported                                       |
| commission, swap, cost currency                            | self-reported                                       |
| price author (user or named agent)                         | recorded fact                                       |
| `r_vs_plan`, `r_vs_actual_risk`                            | engine-derived from self-reported prices            |
| `r_availability`, `stop_provenance`, `r_math_version`      | recorded fact                                       |
| net R                                                      | engine-derived, and only with a documented 1R value |

### Performance and research

| Field                                                              | Class                                         |
| ------------------------------------------------------------------ | --------------------------------------------- |
| My Journal expectancy and distributions                            | engine-derived from self-reported prices      |
| Broker Account expectancy and distributions                        | engine-derived from customer broker evidence  |
| P-Trades Benchmark expectancy and distributions                    | engine-derived from controlled demo benchmark |
| Wilson intervals, cluster-bootstrap intervals, BH-adjusted results | engine-derived, diagnostic-only unless mature |
| shadow outcomes, fill rates, payoff stats                          | replay-derived                                |
| candidate cohorts, filter lift                                     | replay-derived, admin-only                    |

### Execution

| Field                                      | Class                                 |
| ------------------------------------------ | ------------------------------------- |
| delivery state, reason, config version     | recorded fact                         |
| quantity in the payload                    | engine-derived (authoritative sizing) |
| acknowledgement                            | receiver-reported                     |
| associated broker deal, fill and held stop | broker evidence                       |

## The important distinctions

1. **Confidence is not probability.**
2. **Performance sources stay separate.** SELF-REPORTED JOURNAL, CUSTOMER BROKER
   EVIDENCE and CONTROLLED BENCHMARK are never summed or substituted. Scanner
   replay remains research-only.
3. **Replay is not a track record.** No order was placed; no spread, commission,
   swap or slippage beyond the plan's own tolerances is included.
4. **Margin is an estimate**, never a broker margin quote.
5. **"Verified" is never used alone.** A price is verified _against a named source_
   or it is self-reported.
6. **Advisory exposure describes your journal.** A connected-account boundary is
   a separate pre-submit broker-state check.
7. **An empty view is data**, not an outage — and not a market claim either. A
   filtered/capped/settings-scoped empty result means only that no rows match that
   view. A scanner-wide "No Trade" statement requires an unfiltered, current-cycle
   source.

## Failure behaviour

A missing provenance-bearing input produces an explicit refusal with a reason. No
value is defaulted, coalesced to zero, or silently fabricated to fill a gap.

"Fail closed" is scoped: an input the app genuinely cannot know is refused with a
named reason, while a value the app _can_ derive but cannot confirm against a
broker is allowed **only** when it is explicitly labelled as an estimate (margin
is the canonical example). Labelled estimate — permitted. Silent invention —
never.

## What this map does not guarantee

That self-reported values are true. It guarantees only that they are labelled and
attributed.

## Implementation

`src/lib/scanner/*`, `src/lib/risk.ts`, `src/lib/sizing/*`, `src/lib/broker/*`,
`src/lib/journal/*`, `src/lib/stats/*`, `src/lib/execution/*`,
`src/lib/delivery/*`, `src/lib/accounts/*`, `src/lib/evidence/*`.

## Tests

The zero-hallucination rule is enforced, not documented on trust:
`src/lib/mcp/__tests__/list-signals.behavior.test.ts` (no scanner-wide "No Trade"
claim from a filtered view), `src/lib/sizing/__tests__/*` and
`src/lib/__tests__/risk*.test.ts` (refusals instead of defaulted inputs), and
`src/test/__tests__/docs-contract.test.ts` (this map stays in step with the code).
