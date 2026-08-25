# Automatic trading: one set of rules, honestly enforced

Your broker connection is live and the account is armed to Demo Auto. What is missing is control: right now, **every published A+/A/B setup is queued to an armed account**, ignoring your instrument list, session list, alert grade and daily cap. Those filters only govern your feed and your alerts today. That is the gap this closes.

Per your decisions: one global rule set in Settings, identical to your alert rules, plus broker leverage shown read-only and risk controls that apply to automatic orders.

## 1. Automatic orders obey your existing rules

The rules that already decide whether you get alerted will decide whether an order is placed:

- **Instruments** — only the instruments you selected.
- **Sessions** — only the sessions you selected.
- **Grade tier** — the alert grade threshold (A+ only, A and above, B and above). C-Grade never executes, as today.
- **Trades per day** — your daily cap. Cap 0 stays unlimited; C never consumes it.
- Retention/expiry — an expired setup is never queued.

Same rules as alerts means: if a setup was worth alerting you about, it is a candidate for an order; if it was filtered out, no order exists for it.

## 2. Settings gets an "Automatic trading" summary

A new section in Settings, above the automated-execution block, that states in plain words what your current settings mean for real orders, derived from live state — not a second set of switches to keep in sync:

```text
Automatic orders: ARMED on 10012349863 (DEMO, MT5)
Will place orders for:  XAUUSD, GBPAUD, EURUSD
Grade:                  A and above
Sessions:               London, London/NY overlap, New York
Trades per day:         5  (2 used today)
Risk per trade:         1% of 100,000 EUR
Lot ceiling:            no limit
Broker leverage:        1:100  (read from your broker)
```

- When no account is armed it says so and explains that changing these rules affects the feed and alerts only.
- Each line links to the field that controls it, so there is one place to edit each rule.
- "Trades per day" shows today's used count from the same sequence the engine uses, so the number is never a guess.

## 3. Risk controls for orders

- **Risk per trade %** and **lot ceiling (max position size)** stay where they are, and the summary states explicitly that these are the inputs used to size automatic orders (already true in the pre-send sizing path).
- **Leverage** becomes read-only where the broker reports it, labelled broker-derived. The self-entered leverage field remains only as the fallback used for margin estimates when no broker figure exists, and is labelled as such.

## 4. Nothing weakens the existing safety gates

Order placement still requires, unchanged: broker-confirmed DEMO for Demo Auto, READY and un-conflicted connection, trading allowed, not investor mode, resolved broker symbol, fresh broker equity, margin check, account exposure boundary, system-wide Demo Auto on, and pre-send revalidation. The new rules can only _reduce_ what is sent, never authorise something previously refused. Live execution stays off.

## Technical notes

- Customer direct-account enqueue moves out of the `enqueue_execution_deliveries` trigger into the TypeScript publication path, so it uses the canonical `src/lib/delivery/eligibility.ts` (`channel: "alert"`, cap frame included) instead of a second rule implementation in SQL. The trigger keeps the bridge-webhook and benchmark paths untouched.
- Insert uses the existing `bridge_profile = 'metaapi_direct:<accountId>'` conflict key, so idempotency and the delivery state machine are unchanged.
- Enqueue failures are contained: they log and never fail a scan job or touch any statistic.
- The Settings summary reads armed accounts via the existing `listConnectedAccounts` server fn and the cap count via the same day-frame helper the feed uses.
- Tests: eligibility-gated enqueue (instrument/session/grade/cap refusals, cap 0 unlimited, C never queued), and a summary-copy test asserting the no-account-armed wording.
- Zero-Hallucination respected: no seeded rows, no invented broker figures; unavailable numbers render as unavailable rather than zero.
