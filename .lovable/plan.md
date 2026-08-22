# Prompt 12 + 13 — Broker-Spec Position Sizing, then Webhook Control Plane

Plan only. Prompt 12 ships and verifies first; Prompt 13 is built against that verified HEAD.

## 1. Goal
Sizing numbers must be broker-true or explicitly unavailable, and any outbound execution
POST must be a controlled, authenticated, revalidated, idempotent financial action with
kill switches — without touching scanner, grading, replay, research or eligibility.

## 2. Current implementation (re-read at HEAD)
- `src/lib/risk.ts`: three hardcoded `CONTRACT_SPECS` (XAUUSD 100, EURUSD/GBPAUD 100k, lotStep/minLot 0.01), no volumeMax/volumeStep from broker, no stopsLevel, no tick value. Margin = notional/leverage (approximation, currently presented as `marginRequired`). Risk per lot = stopDistance × contractSize × rate — correct only for linear `calcMode=forex/cfd` symbols with profit currency == quote currency.
- Equity: single `scanner_settings.account_equity` (numeric, default 0), manual only. No balance/free-margin/broker-equity distinction. 1 of 5 users has equity > 0.
- Web card: `useQuotes` polls `/api/public/quotes` (15s server cache, 20s client poll). That endpoint unconditionally fetches AUDUSD + GBPUSD every TTL regardless of need.
- MCP: `calculate-position-size.ts` + `fx.ts` already demand-driven (parity/direct/inverse/USD cross), no cache, no freshness metadata returned.
- Risk bounds (`settings-validation.ts`): equity ≤ 1e8, risk% 0.1–10, maxPositionSize ≤ 1000, leverage ≤ 500; sensitive fields need `confirm_risk_change`.
- Webhooks: `webhook.server.ts` POSTs user URL with 5s abort, `Promise.allSettled`-equivalent, secret in body, idempotency header only; `webhook-test.functions.ts` same shape. URL validation is `^https://` regex in the settings UI only — no server-side SSRF defence, no DNS/IP classification, redirects followed by default. PineConnector payload sends one TP (`tp3 ?? tp2`). Logging: `webhook_dispatch_log` (2 rows, 1 enabled user). No delivery state machine, no kill switch, no revalidation before send.
- No `broker_symbol_specs` table exists.

## 3. Confirmed defects
D1 Static contract specs can diverge from the broker (volumeMax, volumeStep, volumeLimit, stopsLevel unknown) → untradable or rejected sizes.
D2 Margin is an approximation labelled as a requirement (false precision; ignores calcMode/currencyMargin).
D3 Equity semantics conflated: a manual number drives money-at-risk with no broker confirmation and no staleness.
D4 Quotes endpoint spends 2 broker requests per TTL for conversions nobody may need.
D5 No stops-level check: a stop closer than broker minimum is unplaceable, yet sized and displayed.
D6 SSRF: user-controlled URL, server-side outbound, no host/IP validation, redirects followed.
D7 Payload secret only (no HMAC/timestamp/nonce) → replayable, forgeable if URL leaks.
D8 Idempotency is advisory (header only); a worker retry can double-fire.
D9 No pre-send revalidation (TIF, quote freshness, spread, max acceptable entry, session, risk guardrail).
D10 HTTP 200 treated as delivery success; no order id / broker acceptance contract; no reconciliation.
D11 Multi-TP mismatch: signal carries TP1/2/3, bridge gets one TP — UI/manifest wording must not imply managed execution.
D12 No kill switches (global/user/instrument/bridge/dry-run).

## 4. Hidden/secondary risks
- `webhook_dispatch_log` has no RLS-safe user exposure design; endpoint URLs are logged (semi-secret).
- Any spec change silently alters risk-panel and MCP numbers with no versioning → add `spec_source` + `sizing_model_version` so history stays interpretable.
- SSRF hardening will break the one existing enabled webhook user if their host fails validation → needs a validation report, not a silent drop.
- Adding revalidation could reduce alert/execution volume; must be measured (baseline) and must never feed back into shadow/regime/payoff statistics (Prompt 7/8 invariant).
- Serverless: DNS-resolved-IP pinning is not available in Workers `fetch`; documented limitation (see §24).

## 5. Alternatives (condensed)
**Specs**: (A) keep static — zero cost, keeps D1/D5 forever; reject. (B) fetch per render — accurate, multiplies MetaApi usage, violates the no-extra-usage constraint; reject. (C) **cached `broker_symbol_specs` table, refreshed by the existing scan cron (once per symbol per 24h or on `spec_stale`), read by both web and MCP; missing/stale row ⇒ `no_spec`/`stale_spec` unavailable rather than static fallback** — recommend.
**FX**: (A) current fixed pair list; reject (D4). (B) full graph/Bellman-Ford triangulation; over-engineered for USD/EUR/GBP/AUD. (C) **keep the existing deterministic parity/direct/inverse/USD-cross planner from `fx.ts`, promote it to the single shared implementation, back it with a `fx_quote_cache` (TTL + `as_of`), and make `/api/public/quotes` fetch conversion legs only on demand** — recommend.
**Margin**: (A) keep notional/leverage silently; reject. (B) **compute the same number but return `margin_basis: "estimate_notional_over_leverage"` and label it "Estimated margin" in UI/MCP; upgrade to broker-authoritative later if a margin RPC is wired** — recommend.
**Portfolio risk**: (A) covariance model — no data; reject. (B) **deterministic hard exposure limits** (max total open initial risk %, max pending risk %, daily realized loss %, per-currency concentration, per-instrument count) computed from `executed_trades` + pending deliveries — recommend, advisory-first then blocking for execution.
**SSRF**: (A) allowlist of known bridges — safest, least flexible; offer as opt-in strict mode. (B) **centralized `assertPublicHttpsUrl()`: WHATWG parse, https only, no credentials/userinfo, port ∈ {443}, DNS A/AAAA resolution via DoH, reject loopback/private/link-local/CGNAT/multicast/IPv4-mapped/metadata ranges, `redirect: "manual"` (no redirect following), re-validated at send time not only at save time** — recommend (OWASP SSRF guidance: validate at request time, deny by default).
**Idempotency**: (A) header only; reject. (B) **`execution_deliveries` table, unique `(user_id, signal_id, bridge_profile)`, states pending→claimed→sent→acknowledged|rejected|unknown|failed, claimed via a security-definer RPC with `FOR UPDATE SKIP LOCKED`** — recommend (same pattern as `claim_scan_job`).
**Auth**: HMAC-SHA256 over `timestamp.nonce.body` in `X-PTrades-Signature` + `X-PTrades-Timestamp`, 300s window, documented receiver verification; secret stays server-side. PineConnector keeps its licence line (bridge cannot verify HMAC) and is labelled unauthenticated-by-bridge.

## 6. Math / numerical fixtures (hand-calculated, equity 10,000 USD, risk 1% = 100)
- XAUUSD long entry 2400.00, stop 2388.00 → distance 12.00 × 100oz = 1200 USD/lot → raw 0.0833 → floor 0.01 step = 0.08 lots, risk 96.00 USD, notional 0.08×100×2400 = 19,200, est. margin @1:100 = 192.
- EURUSD long 1.08500, stop 1.08000 → 0.005 × 100,000 = 500 USD/lot → raw 0.20 → 0.20 lots, risk 100.00, notional 21,700, est. margin 217.
- GBPAUD long 1.95000, stop 1.94000, AUDUSD 0.6500 → 0.01 × 100,000 = 1000 AUD/lot × 0.65 = 650 USD/lot → raw 0.1538 → 0.15 lots, risk 97.50 USD, notional 0.15×100,000×1.95×0.65 = 19,012.50, est. margin 190.13.
- Edge cases: stop distance below broker `stopsLevel` ⇒ `below_stops_level` unavailable; raw < `volumeMin` ⇒ `below_minimum_lot`; raw > `volumeMax`/`volumeLimit` ⇒ capped + warning; missing/stale spec or FX ⇒ unavailable reason, never a guess.

## 7. Schema changes
`broker_symbol_specs` (symbol PK, contract_size, tick_size, tick_value, volume_min/max/step/limit, stops_level, freeze_level, currency_profit, currency_margin, trade_mode, calc_mode, digits, raw jsonb, fetched_at, source) — read: authenticated SELECT; write: service_role only.
`fx_quote_cache` (symbol PK, bid, ask, mid, as_of, fetched_at) — service_role write.
`scanner_settings`: `equity_source` ('manual'|'broker'), `broker_equity`, `broker_balance`, `broker_free_margin`, `broker_state_at`, `execution_enabled`, `execution_dry_run`, `risk_ack_high` (advanced override ack), portfolio limit columns.
`shadow_engine_state`: `execution_kill_switch boolean default true` (global disable, default off-state = executions blocked).
`execution_deliveries` (see §5) + GRANTs + RLS (owner SELECT, service_role ALL).
All additive; no rewrite of historical rows.

## 8. Backend / frontend / MCP
- New `src/lib/broker/specs.server.ts` (fetch + upsert, called from the existing scan cron only), `src/lib/broker/specs.ts` (pure spec→sizing adapter), refactor `risk.ts` to accept an injected spec + `sizing_model_version` and add reasons `no_spec`, `stale_spec`, `below_stops_level`, `volume_limit_exceeded`.
- New `src/lib/execution/outbound-url.server.ts` (SSRF guard), `signing.ts` (HMAC), `delivery.server.ts` (claim/mark state machine), `revalidate.server.ts` (TIF, quote freshness, spread, max acceptable entry, session, stops level, risk guardrails, kill switches). `webhook.server.ts` and `webhook-test.functions.ts` both route through them — one implementation.
- Frontend: SignalCard risk panel shows spec source + `as_of` freshness, "Estimated margin", stops-level/volume warnings, equity source badge; Settings gains execution kill switch, dry-run, high-risk warning + advanced override, portfolio limits, and truthful multi-TP copy ("single-target bridge order; TP2/TP3 are not managed automatically").
- MCP: `calculate_position_size` returns `spec_source`, `spec_as_of`, `margin_basis`, `quote_as_of`, guardrail warnings and portfolio-limit verdicts; `update_my_settings` keeps `confirm_risk_change` and adds it to the new risk/execution fields. Manifest wording updated. No new scanner MetaApi calls: spec refresh is 3 symbols/day, FX legs are demand-driven and cached.

## 9. Test matrix
Unit: fixtures in §6 exactly; conversion planner request counts (parity=0, direct=1, cross=2); floorToStep never rounds risk up. Property: `riskAmount ≤ riskBudget`, lots always a multiple of volumeStep, never < volumeMin unless flagged. Integration: spec cache hit/miss/stale; quotes endpoint issues zero conversion calls when unneeded. DB/RLS: user cannot read another's `execution_deliveries` or specs write. SSRF suite: `http://`, credentials in URL, `localhost`, `127.0.0.1`, `::1`, `::ffff:169.254.169.254`, `10.x`, `192.168.x`, `100.64.x`, `metadata.google.internal`, DNS-rebind double-resolve, 302 to private host ⇒ all rejected with reasons; one public host accepted. Idempotency: concurrent double publish ⇒ exactly one `sent`. Failure injection: timeout, 500, non-JSON ack, duplicate retry, stale signal, provider unavailable ⇒ `unknown`/`failed`, never silent success. Regression: full Prompt 7–11 suites stay green (current suite 552).

## 10. Baseline, deployment, rollback
Baseline before Prompt 12: snapshot current risk-calculator outputs for the 3 instruments × current equity settings, spec assumptions, quotes-endpoint MetaApi request count per hour, alert count/day, `webhook_dispatch_log` counts. Data available today is small (154 signals, 352 resolved shadow rows, 25 trades, 2 webhook dispatches, 1 equity-configured user) — sizing/execution baselines will be descriptive only; no fill/expectancy claims will be attributed to these changes. Sizing changes are display/advice only and do not touch signals, grades, replay or statistics, so no shadow model is required for Prompt 12; a `sizing_model_version` is recorded so old advice stays interpretable. Prompt 13 ships dark: kill switch defaults to blocked, dry-run first, per-user opt-in, then live. Rollback: flags flip off (no data destroyed); migrations are additive so a forward-fix migration drops only new columns/tables; `risk.ts` retains the old code path behind `sizing_model_version = 1` until v2 is accepted.

## 11. Acceptance / limits / recommendation
Accept when: every displayed number carries broker provenance or is explicitly unavailable; zero increase in scanner MetaApi usage; no execution POST possible without passing SSRF validation, HMAC signing, revalidation, delivery claim and enabled kill switches; full `bun run verify` and build green.
Cannot guarantee: broker-exact margin without a MetaApi margin endpoint; DNS-pinned request-time IP identity in the Worker runtime (mitigated by resolve-then-validate plus no-redirect, residual rebinding window documented); that a third-party bridge honours idempotency or returns an order id; that MetaApi spec fields match the live broker for symbols the demo account cannot see.
Recommendation: proceed as specified, Prompt 12 then Prompt 13.
