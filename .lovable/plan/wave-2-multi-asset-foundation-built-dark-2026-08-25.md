# Wave 2 — Multi-Asset Foundation, Built Dark

## What the audit found (verified now, not assumed)

- HEAD `75bb090` ("Added provenance engine"), clean working tree, 118 migrations, latest `20260825122911`.
- Lifecycle rows: `XAUUSD`, `GBPAUD`, `EURUSD` = `execution_approved`; all five Wave 1 pairs (`GBPUSD`, `AUDUSD`, `USDCAD`, `USDCHF`, `USDJPY`) = `disabled`. `lifecycle_enforced = false`.
- Broker specifications exist only for the three Wave 0 symbols.
- Telemetry baseline began `2026-08-25 12:15Z`; at the time of this audit there are 2 sampler runs and 5 spread samples. That is well under one hour of evidence.
- No Wave 2 code, symbol, alias, table or mapping exists anywhere in the repository or database (searched for XAGUSD, USOIL, UKOIL, NAS100, US100, USTEC, XTIUSD, XBRUSD, asset class concepts). Nothing to de-duplicate.
- The session model is FX-only by construction: `market-hours.ts` hardcodes FX session hours and a Friday 21:00 / Sunday 21:00 UTC weekend, and the scanner's session buckets mirror it. There is no per-asset calendar, no daily maintenance break, and no holiday concept.

### Consequence for sequencing

Wave 1 has **not** passed its operational checkpoint — its evidence baseline is under an hour old, and the earliest legitimate full-week review is on or after **2026-09-01**. Under the Wave 2 brief's own rule, Wave 2 therefore may not be activated. This plan builds Wave 2 infrastructure **dark**, with every Wave 2 instrument at `disabled` and never sampled, evaluated, published, alerted or executed.

No time gate is simulated. No promotion happens in this work.

## Scope of this pass

1. **Asset-class registry.** Extend `registry.ts` with an `assetClass` field (`fx`, `metal`, `energy`, `index`) and a price-unit descriptor, leaving every Wave 0/Wave 1 literal byte-identical. Add the four Wave 2 canonical symbols as definitions only, wave 2, `spreadFloor: null`, no pip assumption, no guessed contract size or tick value. Existing helpers keep returning FX/Gold values unchanged.
2. **Reject the universal pip rule.** Introduce an explicit price-unit module: metals, energy and indices report in price units, broker points, tick units, spread-to-ATR and monetary tick value. `point x 10` is never used for a non-FX instrument; any call site lacking an authoritative broker `point`/`tickSize` refuses.
3. **Versioned market calendars.** New calendar authority keyed by asset class and instrument, with a version stamped on every sample and candidate: session windows, daily maintenance break, weekend closure, holiday list, source timezone, DST policy, market state and next known closure. Closed markets are reported as closed, never as provider failure; a quote carried across a break is classified stale and refused.
4. **Alias discovery, fail-closed.** A discovery routine that lists the provider's actual symbol inventory and specifications and proposes candidate mappings for the four instruments. It records evidence; it never writes a mapping. Missing, ambiguous, multi-alias, stale, mismatched or wrong-trade-mode results refuse and are recorded with the exact reason. No alias from the brief is treated as correct.
5. **Sampler and capacity governance.** Extend the existing sampler, no parallel system: asset-aware validity checks, calendar-aware sampling windows, per-instrument request caps, per-instrument breakers, and separate aggregation namespaces so energy and index spreads are never pooled with FX or metals. Add a capacity budget calculation that projects incremental quote/candle/spec/conversion/sampler/ATR load against the current baseline and refuses activation without headroom.
6. **Strategy portability audit, written not applied.** A documented audit of V1/V2/V3 assumptions (ABC detection, ATR periods, stop buffers, entry distance, gap handling, volatility classes, cooldown, caps) per asset class, plus a versioned asset-class strategy manifest structure that is defined and tested but wired to nothing until an instrument legitimately reaches shadow. Wave 0/Wave 1 strategy behaviour is untouched.
7. **News-risk and correlation groups as data.** Per-instrument news-risk category (Fed/CPI/NFP; EIA/OPEC/supply; US macro/index) and correlation groups (`metals_usd`: XAUUSD+XAGUSD, `energy`: USOIL+UKOIL, `index_risk`: NAS100). Portfolio aggregation treats a group as one exposure. Default policy unchanged: no new trade around high-impact news.
8. **Security.** Every new table gets grants, RLS, service-role restriction and retention; new diagnostics expose no account IDs, logins, tokens, raw payloads or stacks.
9. **Tests.** Alias/ambiguity refusal, metal and index and oil precision, calendars with DST, daily breaks and holidays, stale closed-market quotes, point/tick conversion, per-asset spread aggregation isolation, data-validation prohibitions (no evaluation, candidate, shadow, publication, alert, MCP, enqueue, broker call), breaker isolation, quota headroom, correlation grouping, news suppression, and Wave 0/Wave 1 parity pins.

## Explicitly not in this pass

- No lifecycle transition for any instrument, Wave 1 or Wave 2.
- No Wave 2 sampling, spread floor, strategy evaluation, candidate, shadow execution, signal, alert, MCP exposure or execution.
- No `lifecycle_enforced` change.
- No backfill of legacy provenance rows.
- No claim that any Wave 2 instrument is ready; each ends at `disabled` with its blocker named.

## Technical notes

- New: `src/lib/instruments/asset-class.ts`, `price-units.ts`, `calendars.ts` (+ `calendars.server.ts` for versioned rows), `discovery.server.ts`, `correlation.ts`, `news-risk.ts`, and an asset-class strategy manifest under `src/lib/scanner/manifests/`.
- Extended: `registry.ts`, `precision.ts`, `mapping.server.ts` (asset-aware refusal reasons), `readiness.server.ts`, `telemetry/sampler*.ts`, `telemetry/controls.server.ts` (per-instrument caps and breakers).
- Migrations: calendar version table, per-asset spread aggregation scope column, alias-discovery evidence table, correlation-group table, and four `instrument_lifecycle` rows inserted at `disabled` — each with GRANTs, RLS and service-role-only writes.
- Docs: new `docs/MULTI-ASSET.md`, updates to `SCANNER.md`, `INSTRUMENT-LIFECYCLE.md`, `RISK-SIZING.md`, `EXECUTION.md`, and the docs-contract test extended to pin the asset-class matrix.

## Time gates and the report

At the end of this pass the report will state: starting/ending commit, current-state corrections, migrations deployed, architecture and registry changes, mapping and specification evidence actually gathered, calendar versions, capacity comparison, portability findings, security and test results, residual risks, and for each of XAGUSD, NAS100, USOIL, UKOIL the exact stage (`disabled`) and its blocker. Verdict will be **partially completed and safely paused**: infrastructure operational, evidence not yet accumulated. Earliest legitimate Wave 1 review remains on or after 2026-09-01; the first Wave 2 `disabled → data_validation` decision can only follow that review, and each Wave 2 instrument then needs 10 (preferably 20) completed trading days of its own before any shadow gate.
