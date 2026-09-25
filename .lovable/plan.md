# Audit + plan: reconciliation review, live control center, setup explainer

## Audit result

| Feature | Already there | Missing |
|---|---|---|
| Scheduled reconciliation | Cron worker (`/api/public/worker/reconcile`, `reconcile-active`) reads broker deals, orders and positions and records matched fills as broker evidence; sweeper settles unknown orders | Nothing compares the two sides and **flags** gaps. No check on balances. No review list. |
| Live-account control center | Accounts page shows connection, mode badge, balance/equity, per-account exposure limit, emergency stop and release | Spread across long per-account cards (1,279-line page). No single glance of broker "trading allowed" permission, current open exposure vs limit, and stop state. Poor on phone. |
| Setup explainer | Assistant chat can discuss the user's signals and settings | No dedicated "explain this setup" action; no structured risk factors / rule-conflict output; can't paste a snapshot or rationale. |

## 1. Reconciliation discrepancies (backend-first, small UI)

- Extend the existing reconcile pass (no new worker) with a compare step per armed account: platform open orders vs broker orders, platform-believed open positions vs broker positions, broker fills with no platform delivery, deliveries marked filled with no broker fill, and balance change vs sum of recorded deal profit/swap/commission (tolerance-based).
- Write each mismatch to one new table `reconciliation_discrepancies` (owner-scoped, RLS, kind, severity, both sides' values, first/last seen, status open/acknowledged/resolved). Re-seen mismatches update, not duplicate; vanished ones auto-resolve. Nothing is ever "fixed" automatically — flag only.
- Shown as a small "Needs review" badge + list inside the control center (users) and a count on the Admin panel (owner). Acknowledge button per row.

## 2. Live-account control center (reorganise, don't add a page)

- A compact summary strip at the top of the Accounts page: one row/card per account with connection status, mode, broker permission (trade allowed / read-only, from the broker's account info), open exposure vs the user's limit, emergency stop state, and the discrepancy count.
- Tapping a row scrolls/expands the existing detailed card. Global emergency stop stays as-is, moved next to the strip.
- Mobile: stacked cards with status chips, no horizontal tables.
- Data comes from one new read-only server function reusing existing account/broker fetches, cached briefly so it can't slow the broker.

## 3. "Explain this setup" (reuse the assistant)

- An "Explain" button on each signal card in the Feed, plus an "Explain a setup" box in the assistant where the trader pastes a signal, snapshot text or their rationale (optional screenshot).
- One server function calls Lovable AI (`openai/gpt-6-astra`, streamed, structured output): plain-language setup summary, risk factors, and rule conflicts checked against the user's real settings and cohort blocks, news blackout and exposure limits (those checks are computed in code, the model only explains them).
- Output is labelled "AI explanation — not a trade instruction"; never places orders; unavailable data is stated, not invented. Opens in a bottom sheet on mobile, side panel on desktop.

## Keeping it light
No new pages, one new table, one extended worker, two server functions, reused components. Errors (e.g. out of AI credits) show clearly in place.

## Technical details
- Migration: `reconciliation_discrepancies` + GRANTs + RLS (owner select/update ack; service_role write), unique on (account_id, kind, ref).
- `src/lib/evidence/discrepancies.ts` (pure compare, unit-tested) called from `reconcile.server.ts`.
- `src/lib/accounts/control-center.functions.ts` (requireSupabaseAuth).
- `src/lib/explain/explain.functions.ts` + `ai-gateway.server.ts` run-id helper; rule checks from existing eligibility/cohort helpers.
- MCP/assistant tool `list_discrepancies`; docs updated.
