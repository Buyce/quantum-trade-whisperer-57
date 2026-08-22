# AI assistant access (MCP)

## Purpose

Let an AI assistant read the terminal and maintain the journal on the user's
behalf, over the Model Context Protocol, with the same rules and the same maths as
the web UI.

## Current behaviour

Endpoint: `/mcp`, OAuth-protected, tokens scoped to the signed-in account.
Manifest: `.lovable/mcp/manifest.json`. Connection instructions for humans live at
`/connect`.

### Tools (12)

| Tool | Access | Notes |
| --- | --- | --- |
| `list_signals` | read | `scope=all_published` (default) or `my_scanner`. An empty result means nothing matched the requested filters and scope — it is **not** evidence about the scanner's cycle or that no valid setup exists. Grade filtering and paging happen SQL-side. |
| `get_scanner_status` | read | scanner state; the correct tool for "is it running" |
| `get_market_status` | read | session open/closed/overlap |
| `get_my_settings` | read | filters and risk profile |
| `update_my_settings` | write | sensitive risk fields require `confirm_risk_change=true` |
| `calculate_position_size` | read | uses the shared sizing service; FX lookups are demand-driven and allow-listed |
| `get_intelligence` | read | research-only, gated on maturity |
| `get_shadow_comparison` | read | research-only replay comparison |
| `log_trade_decision` | write | Taken / Skipped; snapshots the plan |
| `update_trade_outcome` | write | outcome and actual prices; stamped as agent-entered |
| `list_my_trades` | read | the user's journal |
| `get_performance_summary` | read | personal performance on one explicit R basis |

### Guarantees the tools uphold

- The same eligibility module, the same sizing service and the same R mathematics
  as the terminal — an assistant cannot be told a different number.
- Every price an assistant writes is stamped **agent-entered**, permanently.
- Risk changes above the high-risk threshold require the same acknowledgement as
  the UI.
- Tool descriptions never claim that an empty result proves a market condition.

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

## Implementation

`src/routes/mcp.ts`, `src/routes/[.mcp]/*`,
`src/routes/[.well-known]/oauth-protected-resource.ts`, `src/lib/mcp/index.ts`,
`src/lib/mcp/tools/*`, `src/lib/mcp/fx.ts`, `settings-validation.ts`,
`src/routes/connect.tsx`, `src/routes/api/public/agent/register.ts`.

## Tests

`src/lib/mcp/__tests__/*` — including invariants that no empty `list_signals`
result may make a Capital-Preservation claim.
