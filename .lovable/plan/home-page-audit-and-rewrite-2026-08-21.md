# Home page audit and rewrite

## What is wrong today

The landing page still describes the Build 1 terminal. Verified against the code:

| Claim on the page                                     | Reality in the code                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Max setups per day: 15" stat tile                    | The global cap was removed. `scanner_settings.daily_setup_cap` defaults to 0 = unlimited, and each user sets their own cap; C-grade setups never count against it.                                                                                                                  |
| "Maximum 15 setups a day" in the Trade Assistant card | Same as above — misleading.                                                                                                                                                                                                                                                         |
| "Setups graded A, B or C"                             | Four tiers exist: **A+, A, B, C** (institutional confluence tier added).                                                                                                                                                                                                            |
| "1:1 / 1:2 / 1:3 targets"                             | TP3 is dynamic: the unbroken H4 structural barrier overrides the 1:3 default when it is closer.                                                                                                                                                                                     |
| "weighted confidence score" (unexplained)             | Weighting is now 35% trend alignment, 25% order block, 20% momentum, 20% volatility.                                                                                                                                                                                                |
| Feature grid (4 cards)                                | Missing every major system built since: shadow replay engine, Bayesian learning engine, per-user risk sizing, AI/agent access over MCP, push + email + webhook alerts, verified trade journal with provenance, weekly comparison report, live market-hours status, installable PWA. |

Correct as-is and kept: 3 instruments (XAUUSD, GBPAUD, EURUSD), 3 timeframes (H4/H1/M15), 15-minute scan cadence, "No Trade" default philosophy, ATR-buffered structural stops, expectancy in R.

## What the new home page will say

Same dark quantitative aesthetic, same hero headline, same two CTAs. Changes:

1. **Stat tiles** — replace the wrong "Max setups per day 15" with honest numbers:
   - Instruments monitored: 3
   - Timeframes per scan: H4 · H1 · M15
   - Scan cadence: every 15 min
   - Grade tiers: A+ · A · B · C
2. **Feature sections** rewritten and expanded into grouped blocks:
   - **Scanner engine** — 15-minute cycle, ABC retracement structure, institutional confluence scoring (35/25/20/20), A+/A/B/C tiers, structure-key dedup so the same setup is not re-published.
   - **Trade profiles** — entry with session-aware dynamic offset, max acceptable entry, ATR-buffered structural stop, 1:1 / 1:2 and a dynamic third target capped by unbroken H4 structure, R:R and confidence score.
   - **Your risk, your rules** — account equity, risk per trade, leverage and max stop-loss inputs turn every signal into a lot size, cash risk and margin figure.
   - **Learning engine** — shadow replay forward-tests every published setup on real candles (triple-barrier), and a Bayesian regime model reports fill and win priors per regime with per-bucket sample floors; advisory only, never fabricated.
   - **Verified performance journal** — log taken/skipped, enter real entry and exit prices, R is recomputed server-side, and every price write is stamped as entered by a human or an AI agent.
   - **Alerts everywhere** — web/Android push, transactional email, and an optional webhook (JSON or PineConnector) for high-grade setups.
   - **Built for AI assistants** — 12 MCP tools plus agent account registration; ChatGPT, Claude and Codex can read setups, size risk and maintain the journal.
   - **Built for stability** — decoupled queue, REST-only market data, 8-second hard fetch timeouts, self-chaining worker, per-instrument health flags.
   - **Live market hours** — which FX sessions are open, closed or in overlap, including the weekend close.
   - **Installable** — PWA, adds to an Android home screen.
3. **Nav/footer** — keep the "Connect an AI assistant" footer link and add a visible link to it from the feature block about AI assistants.
4. **Honesty line** — a short "everything on the terminal is derived from live broker data; when there is no valid setup the feed says so" note, matching the zero-hallucination rule.
5. **Head metadata** — refresh title/description/og text to mention A+ tier, learning engine and agent access; keep it under the length limits.

## Technical notes

- Only `src/routes/index.tsx` changes: the `FEATURES` array grows into grouped section data, the stats array is corrected, and `head()` meta strings are updated. No backend, scanner, or settings logic is touched.
- Long feature list is rendered as two sections (core engine grid, then a denser "systems" list) so the page does not become one endless 10-card grid.
- Existing semantic structure preserved: single `h1`, `h2` per feature card, existing token-based colors only.
