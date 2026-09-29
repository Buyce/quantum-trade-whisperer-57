# Exchange microstructure — shadow foundation

## Purpose

Add exchange-derived order-flow and volume evidence to P-Trades without changing
the production scanner, grades, risk settings or execution path.

This surface is **research-only** until forward evidence proves incremental value.
It must never authorize, resize, cancel or modify a broker order.

## Why a separate feed

MetaApi remains the broker/account/execution boundary. Its XAUUSD candles and
quotes describe the user's destination broker, but spot gold is decentralized and
does not provide one authoritative consolidated tape.

For gold microstructure, P-Trades should map XAUUSD to a centralized COMEX gold
futures reference (initially GC; MGC can be added as a secondary reference).
The reference feed supplies exchange trade prints and, where licensed, market
depth. Broker XAUUSD remains the price/execution instrument.

The two prices must never be assumed equal. Features are normalized or used as
state/confirmation evidence; raw futures price levels are not copied into a spot
order.

## Provider boundary

`src/lib/microstructure/provider.ts` defines a provider-neutral interface.

A production adapter must provide:

- venue/event timestamps;
- trade price and size;
- source-supplied aggressor side where available;
- immutable dataset/schema/instrument provenance;
- optional depth snapshots for later L2/L3 work.

Missing side remains `unknown`. We do not guess it in the ingestion layer.

A suitable first adapter is Databento's CME Globex dataset because it exposes
trade, MBP and MBO schemas through one versionable source. dxFeed is a viable
alternative. Provider selection remains a deployment/configuration concern.

## Phase plan

### Phase 0 — merged by this PR

Pure, provider-neutral contracts and deterministic calculations:

- classified buy/sell/unknown volume;
- delta and delta ratio;
- price change over the observation window;
- tick-bucketed Volume Profile;
- POC and a deterministic 70% value area;
- explicit provenance and `executionEligible: false`.

No network calls, database writes, scanner imports or execution imports.

### Phase 1 — ingestion and storage

Add a server-only adapter and append-only raw/derived tables:

- `microstructure_windows`: one point-in-time feature snapshot per reference
  instrument/window;
- `microstructure_profile_levels`: optional profile levels keyed to a window;
- provider health: last event time, ingest lag, gaps, reconnect count and schema;
- retention policy separating raw events from durable derived features.

Secrets stay server-side. Provider failure produces "unmeasured", never neutral or
zero evidence.

### Phase 2 — shadow feature join

At scanner decision time, attach the latest *past-only* microstructure snapshot to
the research observation. Never fetch future data during replay.

Candidate features:

- window delta / delta ratio;
- cumulative delta slope over fixed windows;
- POC distance and value-area location;
- high/low-volume-node proximity;
- volume expansion percentile;
- price-vs-delta divergence;
- absorption candidate: large aggressive flow with bounded adverse price response;
- exhaustion candidate: shrinking aggressive flow at a structural extreme.

These fields enter a new Q-Core feature-schema version only. Production V1 grades
remain frozen.

### Phase 3 — L2/L3 research

If MBP/MBO is licensed and operationally stable, add:

- top-N depth imbalance;
- add/cancel/modify rates;
- replenishment/absorption;
- sweep intensity;
- queue/depth resilience.

Order-book features require stricter stale-data and sequence-gap gates than trade
prints. A broken book is discarded, never repaired heuristically.

### Phase 4 — evidence gate

Compare identical replay/forward cohorts with and without microstructure evidence.
Promotion requires enough independent days/regimes, out-of-sample improvement in
mean R or another predeclared objective, no unacceptable drawdown deterioration,
and stable provider coverage.

Until that promotion is explicit, microstructure remains shadow-only.

## Gold mapping

Initial logical mapping:

`XAUUSD (broker execution) -> GC front/active COMEX future (reference evidence)`

Contract roll must be point-in-time and recorded in provenance. Historical
backtests use the contract that was active at that timestamp; they may not resolve
today's active contract and apply it backwards.

MGC can later be used as a cross-check, not silently merged with GC volume.

## Safety invariants

1. `executionEligible` is always `false` on microstructure snapshots.
2. No module under `src/lib/execution` imports microstructure during research.
3. Provider outage/staleness => unmeasured.
4. Unknown aggressor side is excluded from delta but included in total volume.
5. Futures reference prices never become spot entries/stops/targets.
6. Backtests use point-in-time snapshots only.
7. Every derived record names provider, dataset, venue, schema, reference
   instrument and observation window.
