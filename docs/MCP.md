# AI assistant access (MCP)

## Purpose

Let an AI assistant read the terminal and maintain the journal on the user's
behalf, over the Model Context Protocol, with the same rules and the same maths as
the web UI.

## Current behaviour

Endpoint: `/mcp`, OAuth-protected, tokens scoped to the signed-in account.
Manifest: `.lovable/mcp/manifest.json`. Connection instructions for humans live at
`/connect`.

### Tools (16)

| Tool                      | Access | Notes                                                                                                                                                                                                                                                |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_signals`            | read   | `scope=all_published` (default) or `my_scanner`. An empty result means nothing matched the requested filters and scope — it is **not** evidence about the scanner's cycle or that no valid setup exists. Grade filtering and paging happen SQL-side. |
| `get_scanner_status`      | read   | scanner state; the correct tool for "is it running"                                                                                                                                                                                                  |
| `get_market_status`       | read   | session open/closed/overlap                                                                                                                                                                                                                          |
| `get_automatic_orders`    | read   | the user's own automatic-order decisions (queued or refused, in the engine's own words) and the resulting broker deliveries; a resting order is never reported as a fill                                                                             |
| `get_risk_holds`          | read   | whether the user's own risk brakes are holding new automatic orders, why, and when the hold lifts; fails closed to `unknown`                                                                                                                         |
| `get_my_settings`         | read   | filters, risk profile, automatic-order rules, gates and brakes                                                                                                                                                                                       |
| `update_my_settings`      | write  | any field that changes how much money can be at risk — risk profile, ceiling, gate or brake — requires `confirm_risk_change=true`                                                                                                                    |
| `calculate_position_size` | read   | uses the shared sizing service; FX lookups are demand-driven and allow-listed                                                                                                                                                                        |
| `get_intelligence`        | read   | research-only, gated on maturity                                                                                                                                                                                                                     |
| `get_shadow_comparison`   | read   | research-only replay comparison                                                                                                                                                                                                                      |
| `log_trade_decision`      | write  | Taken / Skipped; snapshots the plan                                                                                                                                                                                                                  |
| `update_trade_outcome`    | write  | outcome and actual prices; stamped as agent-entered                                                                                                                                                                                                  |
| `list_my_trades`          | read   | the user's journal                                                                                                                                                                                                                                   |
| `get_performance_summary` | read   | personal performance on one explicit R basis                                                                                                                                                                                                         |
| `describe_datasets`       | read   | the training-dataset catalogue: ids, what one row means, provenance, withheld columns and non-guarantees. No rows.                                                                                                                                   |
| `read_dataset`            | read   | owner-gated paged read of one dataset over an explicit UTC window. Read-only; account-identifying columns are withheld. See [DATA-DICTIONARY.md](DATA-DICTIONARY.md).                                                                                |

### Guarantees the tools uphold

- The same eligibility module, the same sizing service and the same R mathematics
  as the terminal — an assistant cannot be told a different number.
- Every price an assistant writes is stamped **agent-entered**, permanently.
- Risk changes above the high-risk threshold require the same acknowledgement as
  the UI.
- Tool descriptions never claim that an empty result proves a market condition.
- Instrument choices come from the instrument registry, so the assistant is never
  told that a live pair is an unknown value.
- Every setting the terminal offers a customer is readable and writable here, with
  the same bounds and the same warnings — the assistant cannot set a value the
  Settings screen would refuse.
- Brakes and gates reported here stop new automatic orders only. Nothing already
  at the broker is affected, and an unreadable risk state reads as `unknown`,
  never as "not held".

## Inputs

An OAuth bearer token identifying the account, plus validated tool arguments.

## Outputs

Text and structured results, with provenance labels in the prose.

## Provenance

Reads are broker-derived or journal-derived, labelled accordingly. Writes are
agent-entered.

## Failure behaviour

An unauthenticated or wrong-audience token is refused. Invalid arguments are
rejected by schema validation. Unavailable inputs produce an explicit refusal with
a reason, never a guessed number.

## User-facing meaning

The assistant sees what the user sees, and can change only settings and journal
entries.

## What assistants cannot do

- Read or place anything at the broker.
- See other users' data.
- Enable live execution, or bypass the live-execution confirmation.
- Alter grading, published signals, replay outcomes or statistics.
- Retrieve secrets.

## Explicit non-guarantees

- Tool availability is not entitlement: a tool answering does not mean the account
  is permitted to act on what it returns.
- An empty or filtered result is not a scanner-wide verdict. Only the scanner
  heartbeat states whether the engine is cycling.
- `timeframes` on the settings tools is deprecated and ignored. A setup is one
  multi-timeframe structure, so there is no per-timeframe filter to set; writes are
  accepted for wire compatibility and answered with a deprecation warning that says
  the value was not stored.
- Statistics returned here are descriptive, not predictive, and carry no
  out-of-sample claim.
- The assistant does not observe the broker: nothing it returns proves a fill.

## Implementation

`src/routes/mcp.ts`, `src/routes/[.mcp]/*`,
`src/routes/[.well-known]/oauth-protected-resource.ts`, `src/lib/mcp/index.ts`,
`src/lib/mcp/tools/*`, `src/lib/mcp/fx.ts`, `settings-validation.ts`,
`src/routes/connect.tsx`, `src/routes/api/public/agent/register.ts`.

## Tests

`src/lib/mcp/__tests__/*` — including invariants that no empty `list_signals`
result may make a Capital-Preservation claim.
