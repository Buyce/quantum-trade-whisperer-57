# Prompt 12 + 13 — Red-Team Review of My Own Plan, and Revised Plan

Plan only. Prompt 12 ships and verifies first; Prompt 13 is built against that verified HEAD.

## A. Defects found in my own previous plan

**A1. "No increase in MetaApi usage" was false.** A `broker_symbol_specs` refresh is, by definition,
new broker calls (3 symbols × 1/day + retries). The honest claim is _bounded_ usage: ≤3 spec calls
per 24h, zero per render, zero inside the scan critical path.

**A2. I assumed a MetaApi symbol-specification endpoint without verifying it.** `metaapi.server.ts`
currently uses only `historical-market-data/.../candles` and `symbols/{s}/current-price`. The
specification route is an ENGINEERING ASSUMPTION until a one-off authenticated read confirms the
exact path and field names (`contractSize`, `tickSize`, `tickValue`, `volumeMin/Max/Step/Limit`,
`stopsLevel`, `freezeLevel`, `currencyProfit`, `currencyMargin`, `tradeMode`, `calcMode`, `digits`).
Revised plan makes that verification step 0, and the whole spec layer conditional on it.

**A3. Broker-confirmed equity is impossible and the plan pretended otherwise.** The MetaApi account
is a single hardcoded shared demo account, not the user's account. `broker_equity` / `broker_balance`
/ `broker_free_margin` columns would either stay NULL forever or, worse, show one demo account's
balance as a user's equity. **Drop them.** Keep manual equity, add `equity_as_of` + a staleness
label, and state plainly that P-Trades has no broker link to the user's account.

**A4. Swapping `risk.ts` onto broker specs is a silent change of financial advice.** Even though it
touches no signal, it changes lots/risk/margin shown to users. Revised: **dual-run sizing** —
compute v1 (static) and v2 (broker spec) side by side, persist divergences to a small
`sizing_divergence_log`, keep v1 authoritative until divergence is reviewed, then flip a flag.

**A5. Making the panel fail-closed on an empty spec table would dark the risk panel for everyone at
deploy.** Static contract specs are _documented instrument facts_, not fabricated market data, so
keeping them is not a zero-hallucination violation — provided they are labelled
`spec_source: "static_v1"` and never called broker-confirmed. Fail-closed applies to _market_ inputs
(FX rate, quote freshness) and to broker-only fields (`stopsLevel`, `volumeLimit`), which are simply
absent rather than guessed.

**A6. `fx_quote_cache` table was unnecessary complexity plus a new write surface** reachable from a
public GET route. Reject it: keep the existing in-instance cache in `/api/public/quotes`, make the
conversion legs demand-driven, and return `as_of` freshness. Revisit only if cross-instance misses
are measured.

**A7. Putting `execution_kill_switch` on `shadow_engine_state` couples execution control to the
research engine** (different owners, different lifecycle, admin-RPC-only access). Use a separate
`execution_controls` singleton.

**A8. HMAC-only signing is backwards-incompatible** with the one live JSON receiver. Revised: keep
the existing body `secret` field, _add_ `X-PTrades-Signature`/`-Timestamp`/`-Nonce` and a
`payload_version: 2`, and deprecate the body secret only after the receiver confirms.

**A9. DNS-over-HTTPS validation inside the publish path is a latency/failure coupling.** The scanner
must never wait on a resolver. Revised: full validation (parse → DoH A/AAAA → public-IP
classification) at **save/test time**, cheap re-checks at send time, and dispatch moved **out of the
publish path** into a claimed-queue worker.

**A10. Automatic retry of an unacknowledged send can double-fire an order.** Revised state machine
never auto-retries `sent` or `unknown`; only `pending` is claimable, and lease expiry moves
`claimed` → `unknown` (fail closed, human/dry-run resolution).

**A11. Portfolio risk cannot be computed from broker state, only from the self-reported journal**
(25 rows, prices often absent, Prompt-9 immutability). So exposure limits are **advisory** and must
be worded "based on trades you logged", never "your account exposure".

**A12. Multi-TP mismatch had no principled resolution.** Insight: the replay registry already
defines `single_exit_first_target`. Align the bridge order with a _named execution policy_ so what a
bridge user gets is the same object the shadow engine measures — instead of inventing a third,
unmeasured behaviour.

## B. Design decisions — why this, best alternatives, why rejected, evidence, what changes my mind

**B1. Cached spec table (+ static labelled fallback).** Alternatives: (i) fetch per render — accurate
but multiplies broker calls per user per card; rejected. (ii) Keep static only — zero cost but keeps
`stopsLevel`/`volumeLimit` permanently unknown; rejected because unplaceable stops are shown as
tradable. Evidence: 3 instruments, spec fields change rarely; 154 signals total, so per-render
fetching buys nothing. Changes my mind: if the spec endpoint is unavailable on this account type,
the spec layer is dropped and only the labelling/estimate work ships.

**B2. Keep the existing `fx.ts` planner as the single implementation.** Alternatives: (i) full graph
triangulation — over-built for USD/EUR/GBP/AUD (4 currencies, all USD-crossed); rejected. (ii) Keep
the unconditional AUDUSD+GBPUSD fetch — 2 wasted calls per TTL forever; rejected. Evidence:
`fx.test.ts` already pins parity=0/direct=1/cross=2 request counts. Changes my mind: adding a
non-USD-crossed account currency.

**B3. Margin stays notional/leverage but is _labelled_ an estimate.** Alternatives: (i) call it
`marginRequired` as today — false precision; rejected. (ii) Hide margin entirely — removes a useful
sanity check; rejected. Evidence: MT5 margin depends on `calcMode`, `currencyMargin`, and symbol
margin rates we do not have. Changes my mind: a verified broker margin calculation endpoint.

**B4. Dispatch via `execution_deliveries` + claiming worker.** Alternatives: (i) in-process fan-out
as today — couples broker/bridge latency to publication and gives no durable idempotency; rejected.
(ii) DB-trigger-driven dispatch — hides financial control flow in SQL and cannot revalidate quotes;
rejected. Evidence: `claim_scan_job`/`claim_shadow_job` already prove this pattern in this codebase.
Changes my mind: if execution stays permanently dry-run-only, a simpler log would do.

**B5. Advisory-first deterministic exposure limits.** Alternatives: (i) covariance/portfolio VaR — no
data (25 self-reported trades); rejected. (ii) Blocking limits immediately — would block on
low-quality journal data; rejected for now, promoted to blocking only for _execution_, never for
feed/alerts.

## C. Failure scenarios the architecture must survive

1. **Spec endpoint 404 for GBPAUD.** Row absent → `spec_source: "static_v1"` shown with a
   "broker-unconfirmed" badge; `stopsLevel` checks report "unknown", not "pass". No lot number is
   invented from a partial spec.
2. **DoH resolver down when the user saves a webhook URL.** Save is rejected with
   `validation_unavailable`; the previously validated URL keeps working; nothing is accepted "just
   this once".
3. **Worker dies after POST, before marking `sent`.** Row stays `claimed`; lease expiry sets
   `unknown` with the request fingerprint; no automatic re-send; admin/dry-run resolves.
4. **Bridge returns 200 with an HTML error page.** No order id → `acknowledged` is not claimed;
   status `unknown`, UI says "delivered to your bridge; broker acceptance unconfirmed".
5. **Agent raises risk 1% → 8% and equity 10×.** `confirm_risk_change` required, clamps still apply,
   high-risk warning persisted, change recorded with `decision_source='agent'`.

## D. Revised plan

**Step 0 (verification, read-only).** Confirm the MetaApi specification route/fields with one
authenticated read per instrument. Record FACT vs ASSUMPTION. Everything spec-dependent is gated on
this.

**Prompt 12**

1. `broker_symbol_specs` (service_role write, authenticated read) + `src/lib/broker/specs.server.ts`
   refresh (≤1/symbol/24h, invoked from the existing scan cron, never per render, never blocking a
   scan) + `specs.ts` pure adapter.
2. `risk.ts` refactor: inject a spec object with `source` (`broker` | `static_v1`) and `as_of`; add
   reasons `below_stops_level`, `volume_limit_exceeded`, `stale_quote`; rename margin output to
   `marginEstimate` with `margin_basis: "notional_over_leverage"`; add `sizing_model_version`.
3. **Dual-run**: v1 remains authoritative; v2 computed in parallel, divergences logged; flip via
   `sizing_v2_enabled` after review.
4. Quotes endpoint: conversion legs fetched on demand only, response carries `as_of`; client shows
   staleness and refuses to size on stale quotes.
5. Settings: `equity_as_of`, conservative default risk (1%), explicit high-risk warning above 2%,
   advanced override acknowledgement, advisory portfolio limits (max total open initial risk, max
   pending risk, daily realized loss, per-currency concentration) computed from the user's own
   journal and labelled self-reported. No broker-equity columns.
6. MCP `calculate_position_size` returns `spec_source`, `spec_as_of`, `quote_as_of`, `margin_basis`,
   guardrail warnings, advisory portfolio verdicts. `update_my_settings` keeps `confirm_risk_change`
   and extends it to new risk fields. Manifest wording updated.

**Prompt 13**

1. `execution_controls` singleton (global disable defaulting to blocked, dry-run, per-bridge and
   per-instrument disable) + `scanner_settings.execution_enabled`, `execution_dry_run`.
2. `outbound-url.server.ts`: WHATWG parse, https only, no userinfo, port 443, DoH A/AAAA, reject
   loopback/private/link-local/CGNAT/multicast/IPv4-mapped/metadata, `redirect: "manual"`. Used by
   both save-time validation and the dispatcher — one implementation, no frontend-only regex.
3. `execution_deliveries` (unique `user_id, signal_id, bridge_profile`; states pending → claimed →
   sent → acknowledged | rejected | unknown | failed; claim RPC with `FOR UPDATE SKIP LOCKED`; owner
   SELECT, service_role ALL). Publication enqueues; a worker dispatches.
4. `revalidate.server.ts` before every send: signal active, TIF unexpired, quote fresh, spread
   acceptable, price still inside `max_acceptable_entry`, session open, stop ≥ `stopsLevel`, risk and
   exposure guardrails, kill switches. Any failure → `rejected` with a reason, no POST.
5. Signing: HMAC-SHA256 over `timestamp.nonce.body`, 300s window, `payload_version: 2`, body secret
   retained for compatibility; receiver verification documented. PineConnector labelled
   bridge-unauthenticated.
6. Bridge order semantics pinned to a named execution policy (default `single_exit_first_target`);
   UI/manifest state explicitly that TP2/TP3 are not managed by the bridge.
7. Observability: delivery states + reasons in admin telemetry; `webhook_dispatch_log` retained;
   endpoint URLs never exposed to non-owners.

Invariant test: scanner/pipeline modules must not import risk or execution modules — delivery can
never influence publication, eligibility, shadow/research enrolment or any statistic.

## E. New acceptance criteria

Every sizing number carries `spec_source` + `as_of` or is explicitly unavailable; margin is never
called exact; v1 sizing output is byte-identical until `sizing_v2_enabled` flips; broker spec calls
≤3/24h and zero in the scan critical path; no POST can leave the system without SSRF validation,
signature, revalidation, a claimed delivery row and enabled switches; concurrent duplicate publish
yields exactly one `sent`; SSRF suite (http, userinfo, 127.0.0.1, ::1, ::ffff:169.254.169.254,
10./192.168./100.64., metadata.google.internal, redirect-to-private, rebind double-resolve) all
rejected with reasons; Prompt 7–11 suites and the current 552-test baseline stay green.

## F. Remaining risks, confidence, non-guarantees

Risks: spec endpoint may not exist for this account (mitigated by Step 0 and static labelling); DoH
dependency; bridge behaviour is outside our control; journal-derived exposure is low quality; small
data (154 signals, 352 resolved shadow rows, 25 trades, 2 webhook dispatches, 1 user with equity and
1 with a webhook) means execution/sizing baselines are deterministic-fixture comparisons only — no
statistical claim will be made.

Confidence: high for the SSRF, delivery-state-machine, labelling and dual-run work (all local,
flag-gated, additive, testable). Medium for the broker spec layer, entirely because of A2. Low-value
until real usage exists for portfolio limits, hence advisory-first.

Cannot guarantee: broker-exact margin; request-time DNS pinning in the Worker runtime (residual
rebinding window, mitigated by resolve-then-validate and no redirects); that a bridge honours
idempotency or returns an order id; that demo-account specs equal a live broker's; that a
self-reported journal reflects real exposure.

Recommendation: proceed with the revised plan — Step 0, then Prompt 12, then Prompt 13.
