# Admin Runtime Validation (non-trading)

An owner-only check on the Admin page that runs one selected connected account through the full order-preparation chain and stops before any order would be sent. It shows PASS or FAIL for each step, with the exact reason for any FAIL.

## What the admin sees
- A new "Runtime validation" panel on Admin → Intelligence, wrapped in the existing PanelBoundary.
- Pick one or more connected accounts, a symbol, a direction and a price source (live quote), then press Validate.
- Each account gets its own report card with an ordered gate list. The first FAIL marks every later gate as "not reached". Nothing continues past a failure.
- A header states: "Dry run — no order sent, no settings changed."

## Gates (in order, each reuses existing code)
1. Connection health: stored `connection_status`, `provisioning_state`, `disconnected_at`, and the MetaApi account id/region are present.
2. Fresh broker facts: `fetchAccountFacts` (accounts.server) gives balance, equity, free margin, observed-at time and freshness.
3. Account type and permissions: `classifyAccountType` gives demo or live, plus `trade_allowed` and investor mode. Demo only is selected by default. Live accounts are validated read-only and clearly labelled.
4. Risk policy: `accountExecutionPolicy` (accounts/policy.server) gives the policy id and risk %. It is read only and never written.
5. Symbol mapping: `resolveMapping` (instruments/mapping.server) gives the canonical symbol and broker symbol, and refuses ambiguous or stale mappings.
6. Quote and spec: `fetchQuoteFor` (quote-freshness rule from sizing/portfolio) plus `loadAccountSizingSpec` / `accountSpecStale`.
7. Account sizing: `resizeFromBrokerSnapshot` (execution/resize.server) gives the risk amount and lots, and `validateQuantity` checks the volume.
8. Margin: `estimateMargin` (metaapi/margin.server) is the only call to `calculate-margin`. The existing diagnose_broker_margin tool already uses this path.
9. Reconciliation health: the account has no open critical `reconciliation_discrepancies` and its last reconcile is recent. This is read only; it does not call `reconcileBrokerEvidence`.

## Report fields (sanitized)
Account id and label, demo/live, connection state, balance/equity/free margin with currency, broker observed-at, policy id, risk %, risk amount, canonical symbol, broker symbol, lots, required margin, gate list `{gate, status: PASS|FAIL|NOT_REACHED, reason}`, and `dry_run: true, trade_endpoint_called: false`.

The report is built by an allow-list (whitelist) projection. MetaApi account ids, tokens, passwords and raw provider bodies are never included.

## Hard non-trading guarantees
- The new module imports nothing from `metaapi/trade.server`, `delivery/*` send paths, `accounts/arm.server`, or any settings writer.
- No DB writes: no delivery rows, no mode or risk changes, no divergence log. Sizing divergence logging is skipped.
- Access is owner-only (the email check is repeated on the server) and uses the signed-in `context.supabase`. Because RLS stays on, the owner validates accounts they can read.

## Tests (all [UNIT])
- Static import test: the validator module graph never reaches `trade.server`, `submitPendingOrder`, `submitMarketOrder`, `cancelOrder`, or `arm.server`.
- Behaviour test with a fake MetaApi transport and all execution switches ON plus the account armed live_auto: validation runs, only GET account-information/quote/spec and POST `calculate-margin` are called, `/trade` is never hit, and zero rows are inserted into execution tables.
- Fail-closed tests: one per gate (stale quote, missing policy, ambiguous mapping, investor mode, margin non-finite, open critical discrepancy). Each checks that the chain stops there with the exact reason.
- Sanitizer test: the report contains no key matching token, password, secret, or metaapi_account_id.

## Technical details
- `src/lib/validation/runtime.server.ts`: the pure gate runner, taking injected dependencies (defaults are the existing functions).
- `src/lib/validation/report.ts`: the report types and the allow-list sanitizer.
- `src/lib/validation.functions.ts`: `runRuntimeValidation` (POST, `requireSupabaseAuth`, owner check, zod input: account ids ≤10, symbol, direction).
- `src/components/admin/RuntimeValidationPanel.tsx`: stacked cards on phones.
- Docs: a section in docs/BROKER-ACCOUNTS.md and a one-line rule in AGENTS.md ("runtime validation is dependency-injected and import-isolated from trade paths").
- No migration is needed.
