# Dual-Tier Execution: Latency Mitigation, Order Mechanics & Webhook Dispatch

Goal: close the gap between a 15-minute candle close and the moment a trader can act — without touching the scan schedule, without storing broker passwords, and without proposing order types MetaTrader would reject.

## Review checkpoint answers (read this first)

**1. Max Acceptable Entry formula**

```text
risk   = |entry - stop|
maxAcceptableEntry = entry + dir * (0.15 * risk)      // dir = +1 long, -1 short
```

Rationale: 0.15R of slippage converts a planned 1:3 into ~1:2.55 and a capped 1:1.4 into ~1:1.19 — a real but survivable haircut. Anything beyond that materially breaks the payoff the grade was based on, so it becomes "retest only". The threshold is stored per signal (`max_acceptable_entry`) so the card, the export and any webhook all quote the same number. Signals whose reachable extension is already thin (maxR < 1.5) use a tighter 0.10R tolerance so a marginal setup cannot be slipped into negative expectancy.

**2. MetaTrader order mechanics — confirmed**

- A Buy Stop must sit **above** current price; a Sell Stop **below**. Placing one on the wrong side is rejected (invalid price / invalid stops).
- After price has already broken past entry, the only valid pending order back at entry is a **Buy Limit (below price) / Sell Limit (above price)**. So the "price ran away" case is guidance to place a **plain limit for the retest** — never a stop or stop-limit.
- Inside the safe zone the trader is told "market or limit both fill" because price is at/near entry, which is exactly where a limit is valid too.
- No stop-limit orders are proposed anywhere in this work.

**3. Webhook dispatch is non-blocking — confirmed**

Signal insert commits first; dispatch runs after. Each user's POST is wrapped in its own `try/catch` with an `AbortSignal.timeout(5000)`, and all recipients are fanned out through `Promise.allSettled`, so a hung or dead endpoint can neither throw into the pipeline nor add more than ~5s once. The existing 20s worker budget is respected: if the budget is exhausted, dispatch is skipped with a logged warning rather than risking a mid-write abandon.

## What gets built

### 1. Settings — "Execution & Delivery Preferences"

A new card in the existing Settings tabs (Notifications tab), matching current card/label/Chip styling.

- **Order Strategy Guidance** (radio): `Smart Adaptive` (default) — market when inside the safe zone, limit on retest; or `Strict Break-and-Retest` — limit orders only, the card never says "market".
- **Broker Integration** (switch, default off): Enable Webhook Dispatcher, with Webhook URL, Webhook Secret / License ID, and Payload Format (`PineConnector (comma separated)` | `JSON`).
- Inputs validate on save: https-only URL, secret required when enabled. Secret renders masked once saved.

### 2. Tier 1 — Smart Order Guidance

- `profile.ts` computes and returns `maxAcceptableEntry`; pipeline persists it.
- `SignalCard.tsx` extends the existing live-quote logic (`/api/public/quotes`, no new API cost) into three explicit execution states:
  - inside entry→max window: green **SAFE TO ENTER** (wording follows the user's order-strategy preference).
  - beyond max: red **PRICE BEYOND SAFE LIMIT — PLACE LIMIT ORDER FOR RETEST**.
  - through stop: existing **Invalidated** state, unchanged.
- Every setup gains a Time-in-Force badge: **Cancel un-filled orders in 30 minutes (2 candles)**, with the guide-mode tooltip explaining why.
- Copy-order text gains the max acceptable entry and the TIF line.
- No quote available → no execution claim is made (existing "—" behaviour).

### 3. Tier 2 — Webhook Dispatcher

- Fires only for freshly inserted **A+, A and B** signals (C never dispatches).
- Recipient filter reuses the existing settings filter (instrument, session, alert grade) plus `webhook_enabled`.
- Payloads:
  - PineConnector: `LICENSE,buy,EURUSD,sl=1.15548,tp=1.15766,risk=...` (comma separated, one line).
  - JSON: `{ secret, event:"signal", instrument, action, grade, entry, max_acceptable_entry, stop_loss, tp1, tp2, tp3, rr, confidence, expires_in_minutes: 30, signal_id }`.
- Idempotent per `signal_id + user_id` so worker retries never double-send.

### 4. Educational UX & email alert overhaul

**Email (`src/lib/email-templates/signal-alert.tsx`)** — rebuilt as a standalone, self-sufficient trade brief, keeping the existing brand tokens and white body:

```text
Header      P-Trades Hub · Signal alert
Headline    A-grade LONG · EURUSD
Panel 1     Trade profile
            Entry (limit)        1.15621
            Max acceptable entry 1.15632   <- new, highlighted
            Stop-loss            1.15548
            TP1 / TP2 / TP3      ... with real R labels (no hardcoded 1:1/1:2/1:3)
            R:R, Confidence, Grade
Panel 2     Execution rule (amber callout)
            "If your broker price is currently beyond 1.15632, DO NOT enter at
             market. Place a Limit Order at 1.15621 to catch the retest."
Panel 3     Expiration
            "Cancel this order if it is not filled within 30 minutes (2 candles)."
CTA         "Check Live Distance on Terminal" -> https://getptrades.com/feed
Footer      existing alerts/not-advice disclaimer (Lovable appends unsubscribe)
```

`alerts.server.ts` passes the new `maxAcceptableEntry`, real target R labels and TIF fields into `templateData`; template props keep graceful `—` fallbacks. Preview data updated to match.

**Guide Mode** — new tooltip entries on the feed and card explaining, in plain language: what Max Acceptable Entry is (the slippage ceiling where the planned payoff still holds), why the two live states differ, and why the 30-minute time-in-force protects capital (a setup unfilled after two candles is a different market than the one that was graded).

## Technical notes

- Migration adds to `scanner_settings`: `order_strategy text default 'smart_adaptive'`, `webhook_enabled boolean default false`, `webhook_url text`, `webhook_secret text`, `webhook_format text default 'json'`. Existing own-row RLS covers them; no new grants needed beyond the table's current ones. Secrets are per-user config, readable only by that user.
- Migration adds `scanned_signals.max_acceptable_entry numeric` (nullable — historical rows stay untouched, and the card falls back to computing it client-side from entry/stop for older rows).
- New `src/lib/scanner/webhook.server.ts` owns payload formatting + dispatch; `alerts.server.ts` calls it alongside email fan-out. No new server routes, no client-side dispatch.
- Zero-hallucination rule respected: no seeds, no synthetic signals, no fabricated prices; every execution state is derived from stored setup values plus a real shared quote.
- Scan schedule, MetaApi call volume and the REST-only connection remain exactly as they are.
