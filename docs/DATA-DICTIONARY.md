# Data dictionary and team data access

## Purpose

Say what each exportable dataset is, where its numbers come from, how a teammate
or an AI assistant reads it, and what it must not be read as.

## What lives where

| Where              | What is there                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------- |
| GitHub             | schema migrations, every server function, the scanner and replay engines, docs, tests      |
| Lovable Cloud (DB) | every recorded row: setups, replay outcomes, research candidates, broker evidence, stats   |
| The app            | owner-only downloads of those rows, in Admin → Intelligence → **Training data export**     |
| MCP                | `describe_datasets` and `read_dataset`, owner-gated and strictly read-only                 |

Rows are **not** in GitHub. A teammate clones the repo for schema and logic, then
receives data as an export from the app, or reads it through the MCP tools with an
authorised account. There is no other data path, and none of the paths can write.

## Datasets

| Id                    | Table                      | Window column      | Provenance       | One row is                                                              |
| --------------------- | -------------------------- | ------------------ | ---------------- | ----------------------------------------------------------------------- |
| `signals`             | `scanned_signals`          | `detected_at`      | engine-derived   | a published setup, with geometry, grade and its prior at publication     |
| `shadow_replay`       | `shadow_executions`        | `detected_at`      | replay-derived   | one deterministic replay of a setup over stored candles                 |
| `research_candidates` | `research_candidates`      | `detected_at`      | engine-derived   | a structure captured before publication, with its full gate record      |
| `broker_trades`       | `broker_trade_evidence`    | `first_observed_at`| broker evidence  | a broker-reported trade associated with an account or delivery          |
| `payoff_stats`        | `payoff_stats`             | `computed_as_of`   | replay-derived   | a cohort's expected R over the full payoff distribution                 |
| `regime_stats`        | `regime_stats`             | `computed_at`      | replay-derived   | a regime bucket's shrunk fill and TP1-if-filled rates                   |
| `filter_lift_stats`   | `filter_lift_stats`        | `computed_as_of`   | replay-derived   | a gate's counterfactual mean R over the setups it rejected              |
| `spread_stats`        | `instrument_spread_stats`  | `calculated_at`    | broker-derived   | an instrument/session spread distribution with coverage and missingness |

The catalogue in code is `src/lib/datasets/catalog.ts`; it is the single source of
truth and is kept in step with the SQL reads by test.

## Column documentation

Every table above carries a permanent `COMMENT ON TABLE`, and the columns that are
easiest to misread carry a `COMMENT ON COLUMN` — confidence score is a
rule-satisfaction score and not a win probability, `r_vs_plan` and
`r_vs_actual_risk` are never averaged together, replay R never had money at risk.
Comments live in the schema, so any client that inspects the database sees them.

## Inputs

An explicit UTC window (`since` inclusive, `until` exclusive), a dataset id, and
paging (`limit` up to 5,000 rows, `offset`).

## Outputs

Rows exactly as recorded, oldest first, plus the window, the exact row count in the
window, the provenance class and the withheld columns. CSV downloads are flat;
JSONL downloads ship with a companion metadata file carrying the same header.

## Provenance

Prices in `signals` are broker-derived from MetaApi candles; grades, R multiples and
priors are engine-derived. `shadow_replay`, `payoff_stats`, `regime_stats` and
`filter_lift_stats` are replay-derived over stored candles — no order was placed.
`broker_trades` is broker evidence and the only authoritative source of realised
money. `spread_stats` is broker-derived from quote samples.

## Failure behaviour

An unauthorised account gets an authorisation error, never a partial dataset. An
unknown dataset id is rejected. An empty window returns zero rows and a row count of
zero; nothing is ever filled in, smoothed or generated to make an export look
populated.

## User-facing meaning

An export is a snapshot of what P-Trades actually recorded in the window asked for.
Two exports of the same window agree, because the rows are immutable history rather
than a recomputation.

## Explicit non-guarantees

- No dataset is a forecast, a promised return or a live-money track record.
- Demo broker evidence is demo evidence; it is labelled by `broker_account_type`.
- Replay statistics are in-sample measurements over stored candles.
- An empty page is not evidence about the scanner's current cycle — the scanner
  heartbeat is the only authority on that.
- Account credentials, broker logins, bridge secrets and email addresses are never
  exported; account identifiers are withheld in the database, not filtered in the UI.

## Implementation

- `src/lib/datasets/catalog.ts` — dataset catalogue, provenance and page limits.
- `src/lib/datasets/datasets.functions.ts` — owner-gated server reads.
- `public.read_training_dataset` / `public.count_training_dataset` — SECURITY DEFINER
  SQL reads that re-apply the owner gate and withhold identifying columns.
- `src/components/admin/DatasetExportPanel.tsx` — the owner-only download surface.
- `src/lib/mcp/tools/describe_datasets.ts`, `src/lib/mcp/tools/read_dataset.ts` — the
  read-only assistant surface.

## Tests

`src/lib/datasets/__tests__/catalog.test.ts` asserts the catalogue matches the SQL
whitelist, that account-identifying columns are withheld from broker evidence, and
that both MCP tools are registered read-only with no write path.
