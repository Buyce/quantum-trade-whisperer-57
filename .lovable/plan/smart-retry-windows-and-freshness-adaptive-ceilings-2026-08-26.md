# Smart Retry Windows and Freshness-Adaptive Ceilings

Two additions to the automatic-order path. Neither relaxes a safety gate, changes grading, sizing mathematics, lifecycle, research or performance accounting. Live real-money execution stays globally disabled.

## 1. Smart retry window — a guaranteed last look before expiry

Today a momentary refusal (missing or stale quote, briefly wide spread, price off the pending side, account refresh unavailable, market closed) returns the delivery to `pending` and it is re-asked on a later minute pass. The weakness is the tail: a setup can lapse into a terminal `tif_expired` simply because the last dispatch pass happened to land minutes before the owner's window closed, so no attempt was made near the end of the window.

What changes:

- Deliveries whose owner window is close to closing are dispatched FIRST, ahead of younger rows, so the end of the window is never lost to queue position.
- Inside the closing tail, one final re-check is forced: a fresh destination quote and a fresh armed-account broker refresh are demanded rather than accepted from any earlier read in that pass. Order geometry and quantity are re-derived from those fresh numbers.
- A delivery may only be settled `tif_expired` after either that final tail re-check was actually performed and refused, or the window has fully elapsed. This closes the "expired without ever being asked at the end" case.
- The tail attempt is recorded (attempt count, reason, and a flag marking it as the final look) so History and the decision report can show that the setup got its last chance and why it still refused.

What does NOT change — this is what keeps false entries flat:

- Every gate runs again from scratch on every attempt: instruments, sessions, grade and C-grade opt-in, daily and concurrent ceilings, intelligence gate, exposure, lifecycle capability, maximum acceptable entry, pending-limit side, spread bound, equity freshness (15 minutes) and quote freshness (90 seconds).
- Terminal refusals stay terminal and are never retried into existence. `sent` and `unknown` deliveries are never re-claimed.
- The owner's window itself is not extended, and the attempt bound stays in place.
- Market entry remains the existing opt-in, still confined to the published maximum acceptable entry.

## 2. Freshness-adaptive daily and per-symbol ceilings

New behaviour, opt-in and default off, so nobody's current limits move without asking.

- New per-symbol daily order ceiling, so one instrument cannot consume the whole day's allowance. Default is permissive enough to be a no-op for current usage.
- A freshness health reading per owner, computed only from broker-reported facts already stored: age of the armed account's equity observation and recency/availability of destination quotes over a short trailing window. It yields healthy, degraded or unknown.
- When adaptive mode is on:
  - Healthy raises the effective daily and per-symbol ceilings, never above a separate user-set adaptive maximum.
  - Degraded lowers them toward a user-set floor.
  - Unknown behaves as degraded — fail closed.
  - The user's base ceilings remain the default; adaptive never invents room beyond the adaptive maximum the user typed.
- When adaptive mode is off, today's fixed ceilings apply exactly as now.
- Every enqueue decision records which ceiling applied and the health reading that produced it, so a refusal is explainable and the adaptive path is auditable.

## Where this shows up

- Rules, alerts & automatic orders: per-symbol daily ceiling, adaptive toggle, adaptive maximum and floor, each with plain-language help stating that adaptive room is bounded by your own numbers.
- Automatic-order decisions: the ceiling in force and the freshness reading at decision time; the existing wording that refusals are not missed profits stays.
- History: the final-look attempt is visible, and refusals stay attributed to P-Trades rather than the broker when nothing was submitted.

## Technical notes

- `src/lib/delivery/dispatch.server.ts` — claim ordering weighted by remaining owner window; tail detection; forced-fresh flag passed into revalidation; expiry only after a tail attempt or full elapse.
- `src/lib/delivery/revalidate.server.ts` — accepts the forced-fresh flag: mandatory destination-account refresh and destination quote, no stored or benchmark fallback; existing `account_refresh_unavailable` / `quote_unavailable` refusals reused.
- `src/lib/delivery/execution.ts` — retry classification and tail semantics documented; no new retryable safety reason.
- `src/lib/delivery/direct-enqueue.server.ts` — per-symbol daily count query (UTC day, dry runs excluded, bounded lookback), effective-ceiling resolution, new decision reasons; unreadable counts fail closed.
- New pure module for freshness health and effective-ceiling derivation, unit tested without I/O.
- Migration adds `scanner_settings` columns: per-symbol daily ceiling, adaptive enabled, adaptive maximum, adaptive floor — all `NOT NULL` with defaults preserving current behaviour, plus range checks.
- Invariant tests: tail ordering, forced-fresh refusal path, no expiry without a final look, terminal reasons never retried, adaptive clamping (healthy/degraded/unknown, floor and maximum bounds), per-symbol ceiling counting and zero semantics.
- Docs: `docs/EXECUTION.md` retry-tail and adaptive-ceiling sections; Guide FAQ entry.
