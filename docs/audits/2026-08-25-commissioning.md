# Accelerated commissioning — Wave 1 / Wave 2 validation (2026-08-25)

This is an accelerated **same-day no-op and rollback proof**, not a week-long
baseline. Nothing here claims evidence, shadow validation or profitability
testing is finished.

## 1. Starting and ending state

| Item              | Value                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Starting HEAD     | `dbba003`                                                                                                    |
| Migrations before | 115                                                                                                          |
| Migrations added  | audited `set_execution_control`, admin `get_admin_commissioning`, plus three privilege-revocation migrations |
| Tests             | 1173 passed, 2 expected fail, 0 failed, 98 files, ~11s                                                       |
| Typecheck         | clean                                                                                                        |
| Build             | OK                                                                                                           |

The two expected-fail tests are the pre-existing `*.v2.test.ts` intended-behaviour
cases: they document desired V2 semantics that current V1 deliberately does not
implement, and they are non-blocking by taxonomy rule.

## 2. Lifecycle no-op proof (before the switch)

- Wave 0 `XAUUSD`, `GBPAUD`, `EURUSD` — `execution_approved`.
- Wave 1 `GBPUSD`, `AUDUSD`, `USDCHF`, `USDCAD`, `USDJPY` — `disabled`.
- Wave 2 `XAGUSD`, `USOIL`, `UKOIL`, `NAS100` — `disabled`.
- Sampler symbols: `{XAUUSD, GBPAUD, EURUSD}` only.
- Flags: `lifecycle_enforced=false`, `live_execution_enabled=false`,
  `live_auto_enabled=false`, `demo_auto_enabled=true`.

So enabling enforcement was a genuine no-op: the enforced universe equalled the
Wave 0 set already in production.

## 3. Flag change and rollback drill (audited path only)

All three transitions went through `set_execution_control`, which requires an
actor, a reason and the expected previous value, and writes
`execution_control_changes`:

| At (UTC) | Old   | New   | Reason                                                                                                           |
| -------- | ----- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| 13:44:17 | false | true  | Accelerated Wave 1/Wave 2 validation commissioning; expansion instruments remain disabled during the no-op proof |
| 13:44:26 | true  | false | Rollback drill step 1                                                                                            |
| 13:44:26 | false | true  | Rollback drill step 2                                                                                            |

Rollback was clean: Wave 0 stages unchanged, no expansion job created, no
execution regression. End state `lifecycle_enforced = true`.

## 4. Telemetry

Sampler, aggregation, retention, capacity and readiness workers were already
enabled. Bounded ceilings were raised through the audited telemetry RPC:
`max_instruments_per_run 3 → 12`, `max_requests_per_run 6 → 24`,
`daily_request_budget 288 → 1152`. Cadence stays 15 minutes and only
lifecycle-authorised instruments are sampled. Wave 0 baseline label remains
`2026-08-25T12:15:00Z`.

Samples collected at the time of writing: XAUUSD 4 valid, GBPAUD 4 valid,
EURUSD 2 valid + 3 classified `malformed` (zero-spread ticks are classified, not
counted as valid).

## 5. Readiness results

Each instrument ran the full pass: alias discovery from the live broker
inventory (12,494 symbols), exact specification refresh, readiness snapshot with
H4/H1/M15 series, live quote, conversion legs, breaker and capacity.

### Wave 1

| Instrument | Provider symbol  | Spec     | Result              | Blocker                                             |
| ---------- | ---------------- | -------- | ------------------- | --------------------------------------------------- |
| AUDUSD     | `AUDUSD` (exact) | complete | **data_validation** | none                                                |
| GBPUSD     | `GBPUSD` (exact) | complete | stays disabled      | H4/H1 candle fetch exceeded the 8s provider timeout |
| USDCHF     | `USDCHF` (exact) | complete | stays disabled      | H4/H1 candle fetch timeout                          |
| USDCAD     | `USDCAD` (exact) | complete | stays disabled      | candle fetch timeout, no fresh quote in the window  |
| USDJPY     | `USDJPY` (exact) | complete | stays disabled      | H4/H1 candle fetch timeout                          |

Mapping and specification are proven for all five. The only blocker for the four
is provider latency on H4/H1 history — the same 8s timeout Wave 0 is currently
hitting on XAUUSD/EURUSD H4. It is retryable, not a mapping or spec defect.

### Wave 2

| Instrument | Discovery                          | Result         | Blocker                                                    |
| ---------- | ---------------------------------- | -------------- | ---------------------------------------------------------- |
| XAGUSD     | candidate accepted, spec refreshed | stays disabled | candle fetch timeout                                       |
| NAS100     | **ambiguous**                      | stays disabled | no unambiguous provider symbol, therefore no specification |
| USOIL      | **ambiguous**                      | stays disabled | no unambiguous provider symbol, therefore no specification |
| UKOIL      | **missing**                        | stays disabled | no matching provider symbol                                |

No alias was chosen between ambiguous candidates and no specification, calendar
or spread floor was invented.

## 6. Wave 2 calendars

`XAGUSD`, `USOIL`, `UKOIL` and `NAS100` calendars remain **unverified**. For
`data_validation` this authorises raw collection under the provider's own market
state and source timestamps only. It authorises no strategy evaluation, no
publication and no execution, and full asset-specific calendars must be sourced
before any Wave 2 instrument may reach `shadow`.

## 7. Prohibition proof for the activated instrument (AUDUSD)

Recorded: readiness snapshot, exact provider symbol, provider specification,
lifecycle transition with evidence and rollback target.

Zero of every prohibited side effect: V1/V2/V3 evaluation, research observation,
research candidate, shadow execution, scanned signal, customer feed item, MCP
item, email, push, execution delivery, bridge POST and MetaApi trade request
(`scanned_signals`, `model_observations`, `research_candidates`,
`shadow_executions` for AUDUSD all 0; `execution_deliveries` 0 overall).

## 8. End-state flags

`lifecycle_enforced=true`; telemetry schedules enabled; Wave 1/2 shadow
enrolment, publication, alerts, MCP visibility and execution all remain
prohibited by the lifecycle matrix; global live execution unchanged
(`live_execution_enabled=false`, `live_auto_enabled=false`); no real-money
setting touched.

## 9. Database linter

32 findings, unchanged in character from the pre-existing baseline: 22
informational "RLS enabled, no policy" rows (engine-internal tables reachable
only by the service role, intentional) and 10 "signed-in users can execute a
SECURITY DEFINER function" warnings on pre-existing admin RPCs that gate on the
owner identity internally. Anonymous SECURITY DEFINER exposure is zero — the new
commissioning RPCs are service-role only.

## 10. Earliest evidence-review dates

| Instrument                      | Earliest legitimate review                                                   |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Wave 0 (XAUUSD, GBPAUD, EURUSD) | baseline from 2026-08-25T12:15Z; full week on/after 2026-09-01               |
| AUDUSD                          | data_validation from 2026-08-25T14:00Z; full week on/after 2026-09-01        |
| GBPUSD, USDCHF, USDCAD, USDJPY  | one week after a successful transition, which has not happened yet           |
| XAGUSD                          | one week after transition; still blocked on candle fetch                     |
| NAS100, USOIL, UKOIL            | blocked before the clock starts: provider symbol must be disambiguated first |

## 11. Next operational steps

1. Retry `commission-readiness` for GBPUSD, USDCHF, USDCAD, USDJPY and XAGUSD in
   a quieter provider window; transition each one individually on a clean pass.
2. Disambiguate NAS100/USOIL/UKOIL provider symbols from recorded discovery
   evidence before anything else.
3. Source broker-verified venue calendars for every Wave 2 instrument.
