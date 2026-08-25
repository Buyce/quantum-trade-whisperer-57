# Scanner

## Purpose

Turn broker candles into graded ABC retracement structures on a fixed schedule,
without exceeding the market-data budget or the Worker's execution limits.

## Current behaviour

1. `/api/public/cron/scan` fires every 15 minutes, authenticates the caller
   against the cron secret, sweeps stale `active` signals to `expired`, and
   enqueues one job per instrument/timeframe unit of work.
2. `/api/public/worker/dispatch` claims queued jobs and self-chains so no single
   invocation runs long enough to hit a CPU ceiling.
3. `/api/public/worker/process` performs one unit: fetch candles, compute
   indicators, detect structure, grade, build the profile, persist.
4. Market data is fetched over **MetaApi REST only**. Streaming connections are
   deliberately not used — they desynchronise silently and leak memory in a
   short-lived Worker.
5. Every outbound broker fetch is wrapped in a hard timeout. On timeout the
   instrument is skipped, flagged as temporarily unavailable, and the cycle
   continues with the next instrument.
6. Broker symbol specifications are **not** refreshed here. They have their own
   daily budgeted job (`/api/public/cron/refresh-specs`) so the scan path's call
   volume stays fixed.

Candle depth is per timeframe: H4 300, H1 300, M15 200 — enough warm-up for a
200-period EMA and for order-block detection to see unmitigated structure.

## Inputs

`INSTRUMENTS` × `TIMEFRAMES` from `src/lib/scanner/types.ts`, broker OHLCV, and
the previous cycle's open signals. At HEAD that is the instruments `XAUUSD`,
`GBPAUD` and `EURUSD` on the timeframes `H4`, `H1` and `M15` — the code
constants are the authority, and `src/test/__tests__/docs-contract.test.ts`
fails if this list drifts from them.

## Outputs

Rows in `scanned_signals` and a companion `market_context` row (session,
volatility context, time of day). Nothing else writes `scanned_signals`.

## Provenance

100% broker-derived candles. There are no fixtures, seeds, demo generators or
fallback setups anywhere in the production path, and adding one is prohibited.

## Failure behaviour

| Condition              | Behaviour                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Broker timeout / error | instrument skipped, flagged, cycle continues                                                                                          |
| Insufficient candles   | no structure is claimed; note that `atr()` returns `0` rather than `null` on short series (pinned V1 defect, see CHARACTERISATION.md) |
| Duplicate structure    | suppressed by structure key + cooldown, so the same setup is never re-published                                                       |
| Worker death mid-job   | the job stays claimable and is retried on the next dispatch                                                                           |

## User-facing meaning

The heartbeat/last-scanned indicator reflects this loop. A gap in it means the
scan path had a problem — not that the market had no setups.

## What the scanner does not guarantee

Completeness. It sees three instruments on three timeframes at 15-minute
granularity. It does not see news, order flow, or intrabar sequence.

## Implementation

`src/lib/scanner/pipeline.server.ts`, `metaapi.server.ts`, `indicators.ts`,
`grading.ts`, `profile.ts`, `types.ts`, `scan.functions.ts`;
`src/routes/api/public/cron/scan.ts`, `src/routes/api/public/worker/*`.

## Tests

`src/lib/scanner/__tests__/*` (indicators, grading, profile, pipeline).

## Timeframes are a scan basis, not a user filter

`TIMEFRAMES` describes how the engine looks at the market, not a preference a user
or assistant can set. A published setup is one multi-timeframe structure whose
grade already depends on H4/H1/M15 agreement, so there is no coherent way to serve
"only M15" of it. The settings control was removed and the `timeframes` argument on
the assistant settings tools is deprecated and ignored, answered with a warning
naming the deprecation. See [MCP.md](MCP.md).
