# Bring the assistant connection up to date with the terminal

Short answer: the connection itself is healthy and secure, but it has drifted behind the app. It still describes a three-instrument, pre-auto-trading product. Nothing it reports is fabricated — it simply cannot see or set several things you now rely on.

## What is confirmed out of date

1. **Instrument list is stale.** The assistant only accepts XAUUSD, GBPAUD and EURUSD. The app's registry now carries twelve instruments (adding GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, XAGUSD, USOIL, UKOIL, NAS100). An assistant asked to add Gold-Silver or an index today is told those are unknown values.
2. **Settings the assistant cannot read.** It reads filters, alerts and the risk profile only. It cannot see: the automatic-order ceilings and order window, the intelligence gate, C-grade permission, market-entry mode, adaptive ceilings, spread/slippage caps, exposure limit, the drawdown and losing-run brakes, the new same-bet limit and same-bet cool-off, or the take-profit choice and its splits.
3. **Settings the assistant cannot change.** Writes cover filters, alerts, risk profile and the take-profit choice. Everything else in the list above is read-only-by-absence, so a user cannot ask an assistant to raise their order window or their same-bet limit.
4. **No view of automatic orders.** There is no tool for the automatic-order decisions, refusal reasons, deliveries, or broker order states — the largest thing the app does since the assistant tools were written.
5. **No view of the risk holds.** When a losing-run or drawdown pause is holding orders, an assistant has no way to say so, and no way to report the cancellations that pause performs.
6. **Documentation lists 12 tools;** the count and capability table will change with this work.

Not out of date: authentication and scoping, the shared eligibility/sizing/R mathematics, agent-entered stamping on journal writes, the high-risk confirmation, and the rule that an empty signal list is never a scanner-wide verdict.

## What to change

**Instruments** — the assistant's allowed instrument list stops being a hardcoded trio and is derived from the same registry the terminal uses, so it can never drift again. Values not yet promoted to live are still refused, with the reason.

**Read tools**
- `get_my_settings` returns the full customer-owned surface, grouped and explained: feed filters, alerts, risk profile, automatic-order rules (ceilings, window, adaptive), gates (intelligence, C-grade, spread/slippage, exposure), brakes (drawdown, losing run and pause length, same-bet limit, same-bet cool-off) and take-profit choice with splits and trailing. Webhook secrets stay hidden.
- New `get_automatic_orders` — recent automatic-order decisions for the signed-in user: queued, refused with the exact refusal reason, sent, acknowledged, filled, expired or cancelled, with instrument, direction, grade and time. Broker-derived states are labelled broker-derived; refusals are engine-derived.
- New `get_risk_holds` — whether the account is currently held, which rule caused it, when it started, when it lifts, and how many matching unfilled orders the pause cancelled (broker-confirmed versus unconfirmed). Absent evidence reports as unknown, never as "not held".

**Write tool**
- `update_my_settings` accepts the automatic-order rules, the gate thresholds and the brake settings, with the same bounds and clamps as the Settings screen — same-bet limit 1–3 only, cool-off 0/30/60/120, order window up to 10 hours, ceilings within their existing ranges. Anything that changes how much money can be at risk (raising the same-bet limit, turning off the cool-off, widening ceilings or loosening a brake) requires the same explicit confirmation flag as the risk fields, and returns the same escalating warning text the UI shows.

**Docs** — `docs/MCP.md` capability table, count and non-guarantees updated; `/connect` and the in-terminal assistant card get one line each on the new abilities.

## Technical notes

- Single source of allowed instruments: `settings-validation.ts` derives choices from `src/lib/instruments/registry.ts` (plus lifecycle stage), removing `INSTRUMENT_CHOICES`.
- Reuse existing clamps from `src/lib/db-types.ts` and `src/lib/delivery/correlated-cluster.ts` rather than re-declaring bounds in MCP code.
- New tools read through `supabaseForUser` only, so RLS scopes them to the caller; no admin client, no platform-wide reads, no broker calls.
- Refusal reasons come from the existing enqueue-log copy so assistant wording matches the app exactly.
- Extend the sensitive-field set so brake-loosening writes need `confirm_risk_change=true`.
- Tests: `[INVARIANT]` coverage that the instrument list matches the registry, that brake-loosening writes are refused without confirmation, that out-of-range same-bet values clamp to 1–3, that an unreadable hold reads as unknown, and that no new tool can claim a scanner-wide verdict from an empty result.
- Unchanged: grading, sizing mathematics, eligibility, live-execution gating (still globally disabled), and the zero-fabrication rule — every new field is broker-, engine- or user-derived and labelled.
