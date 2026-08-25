# Audit — Live news pipeline + Wave 1 data-validation entry (2026-08-25)

This is a dated snapshot of historical evidence as read on that date. It is not
current release status — re-read the database and Admin diagnostics for that.

Scope: build the live economic-event layer on official sources only, then advance the
instrument programme by exactly as much as real evidence allowed on this date.

## 1. What was proven with live calls

**FRED — working.** First production ingestion run:

```
provider=fred job=fred_release_schedule status=ok
eventsReceived=46 inserts=46 duplicates=0 revisions=0 invalidEvents=0 coverageWritten=25
```

Second run immediately after, proving idempotency rather than asserting it:

```
provider=fred status=ok eventsReceived=46 inserts=0 updates=0 duplicates=46 revisions=0
```

**EIA — blocked, and recorded as blocked.**

```
provider=eia status=authorization_error errorClass=rejected_credential errorNote=API_KEY_INVALID
```

The stored `EIA_API_KEY` is rejected by `api.eia.gov` with `API_KEY_INVALID`. The run
ledger records the refusal, `energy_inventory` coverage is `provider_error`, and no
energy event exists. This is a credential replacement task, not a code defect — a new
key must be supplied through secret management.

## 2. Measured coverage after ingestion

Latest snapshot per (provider, currency, family), 50 scopes:

| State                  | Scopes                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| `unsupported`          | 45                                                                        |
| `timestamp_incomplete` | 4 (USD central_bank, inflation, employment, us_macro — FRED is date-only) |
| `provider_error`       | 1 (USD energy_inventory — EIA credential)                                 |
| `healthy`              | **0**                                                                     |

Consequence, stated plainly: **no instrument currently has news coverage that could
clear a new entry.** The policy therefore stays in comparison (dark) mode for every
instrument, including Wave 0. Nothing was switched to `enforcing`, because doing so
would have applied a calendar that cannot resolve intraday timing.

## 3. Instrument programme change

Readiness was re-run per symbol against the live provider (12,494-symbol inventory):

| Symbol                         | Decision                  | Blockers                            |
| ------------------------------ | ------------------------- | ----------------------------------- |
| GBPUSD, USDCHF, USDJPY, USDCAD | may enter data_validation | none (note: `calendar_unverified`)  |
| XAGUSD                         | stays disabled            | `no_candle_series`, `no_live_quote` |
| USOIL, UKOIL, NAS100           | stay disabled             | unchanged from the Wave 2 audit     |

Applied via the audited `transition_instrument_stage` RPC, `disabled → data_validation`,
all four `ok`. Wave 1 is now fully in data collection (AUDUSD was already there).
Sampler symbols extended to the 8 Wave 0 + Wave 1 instruments — inside the existing
12-instrument / 24-request-per-run ceiling. Wave 2 is untouched and unsampled.

Lifecycle state after the change:

```
XAUUSD, GBPAUD, EURUSD        execution_approved   (Wave 0, unchanged)
AUDUSD, GBPUSD, USDCHF,
USDJPY, USDCAD                data_validation      (collection only)
XAGUSD, USOIL, UKOIL, NAS100  disabled
lifecycle_enforced = true     live_execution_enabled = false
```

## 4. Prohibition proof

For all nine non-Wave-0 instruments, counted directly in the database after the
transitions:

```
scanned_signals 0   model_observations 0   research_candidates 0
shadow_executions 0   execution_deliveries 0   instrument_spread_samples 0 (first slot pending)
scan_queue 6        <- expected: data_validation authorises candle collection only
```

The queue rows are the intended effect. `pipeline.server.ts` gates
`evaluate_strategy`, `capture_research` and `publish` behind `lifecycleAllows`, so a
`data_validation` instrument fetches candles and produces no measurement, no
grade, no signal and no order.

## 5. Not done, and why

- **No promotion beyond data_validation.** Wave 1 collection started today; the
  spread/ATR/missingness evidence window has not elapsed. Promotion to shadow
  requires that evidence to exist, not a decision to trust it.
- **No news enforcement.** Zero healthy scopes (section 2).
- **No EIA data.** Invalid credential.
- **No exact release times.** FRED publishes dates only; inventing times would be
  fabrication, so events are stored `date_only` and cannot open a timed window.
- **No live money.** `live_execution_enabled=false`, `live_auto_enabled=false`;
  automatic orders remain demo-only.

## 6. Operator checklist

1. Replace `EIA_API_KEY` with a valid key, then re-run `/api/public/cron/ingest-news`
   and confirm `energy_inventory` coverage leaves `provider_error`.
2. Let the 15-minute sampler accumulate Wave 1 spread/ATR evidence; watch Admin →
   Intelligence → Commissioning for per-symbol readiness.
3. Review Wave 1 spread stats and missingness after a full trading week before any
   `data_validation → shadow` request.
4. Keep news in comparison mode until a required scope reaches `healthy`; per-scope
   `timestamp_incomplete` is the current ceiling for USD.
