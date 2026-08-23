# Product

## Purpose

P-Trades Hub gives one discretionary FX trader a systematic second opinion: a
scanner that examines a fixed instrument set on a fixed cadence, a complete trade
plan for anything that qualifies, an honest position size for their own account,
and a measurement layer that reports what their decisions actually produced.

The product's core claim is **selectivity**. It exists to say "no setup" most of
the time.

## Current behaviour

A user's loop:

1. **Feed** — graded setups that pass their own filters. Often empty.
2. **Signal card** — direction, grade, confidence, planned entry, maximum
   acceptable entry, planned stop, TP1/TP2/TP3 with their true R multiples, R:R,
   time-in-force, session and their own lot size.
3. **Decide** — log the setup as _Taken_ or _Skipped_.
4. **Record** — after the trade closes, add the actual entry and actual exit (and
   the actual initial stop when known) so canonical R can be computed.
5. **Performance** — expectancy and distribution over the trades they logged,
   gated on sample size.
6. **Settings** — instruments, sessions, feed and alert grade thresholds, daily
   cap, risk profile, notifications, assistant access, execution bridge.

## Inputs

Broker market data (candles, quotes); the user's filter and risk settings; the
user's journal entries; optionally, entries made by a connected AI assistant.

## Outputs

Published setups, per-user feed and alerts, position sizes, canonical R values,
descriptive statistics, research-only shadow results, and optional execution
deliveries.

## Provenance

Market structure is broker-derived. Account equity, fills and outcomes are
self-reported. Anything computed from a self-reported input inherits that label.

## Failure behaviour

If market data is unavailable for an instrument, that instrument is skipped and
flagged for the cycle; the others still scan. If a risk input is missing or
stale, the card shows the exact missing input instead of a size. If the journal
lacks the prices for an R measure, R is `null` with a stated reason.

## User-facing meaning

An empty feed means "nothing currently qualifies under these rules and filters".
A confidence score means "how well this structure satisfied the rule set". A
performance figure means "what the trades you logged produced".

## What this product does not guarantee

- It does not predict outcomes; no score here is a win probability.
- It does not see the user's broker account, equity, open positions or margin.
- It does not guarantee a bridge or broker accepted an order unless an
  acknowledgement proves it.
- It does not provide financial advice.

## Implementation

`src/routes/_authenticated/*`, `src/components/SignalCard.tsx`,
`src/lib/queries.ts`.

## Tests

`src/lib/__tests__/performance.test.ts`, `src/lib/mcp/__tests__/*`.
