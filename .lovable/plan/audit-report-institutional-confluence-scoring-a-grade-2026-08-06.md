# Audit Report — Institutional Confluence Scoring & A+ Grade

No files or database objects were changed. This is the audit plus a proposed execution plan.

## Step 1 — Codebase & data pipeline audit

### 1. Candle history depth (currently 200 per timeframe)

Sufficient for the new indicators, with one existing weak spot unrelated to them:

- 14-period RSI: needs ~15 bars plus smoothing warm-up. 200 is far more than enough.
- 20-period ATR moving average: ATR(14) itself consumes 15 bars, then a 20-period MA of ATR needs ~35 bars total. Fine at 200.
- H1/H4 order blocks: 200 H4 bars ≈ 33 trading days, 200 H1 bars ≈ 8 days. Enough to locate the most recent unmitigated institutional zones. Deeper macro zones (multi-month) would not be visible.
- Existing weak spot: `readTimeframe` in `src/lib/scanner/grading.ts` asks for `ema(closes, 200)`. With exactly 200 candles the EMA degenerates into a plain 200-bar average with no smoothing, so the "slow" line is effectively static and the H4 trend read is less reliable than intended.

Recommendation: raise the fetch to 300 candles for H4 and H1 (keep M15 at 200). Cost is only a slightly larger REST payload — no extra requests, no extra latency risk. This gives the EMA200 real warm-up and gives order-block detection more history.

### 2. Database schema impact of adding "A+"

- `scanned_signals.grade` is the `signal_grade` enum (`A`, `B`, `C`, in that sort order). Adding a value appends it after `C`, so the enum's own ordering no longer matches grade quality. Nothing in the app currently sorts or compares by the enum in SQL — ranking happens in TypeScript (`GRADE_ORDER` in `feed.tsx`, `GRADE_RANK` in `alerts.server.ts`), so this is safe as long as we never introduce SQL enum comparisons.
- RLS: unaffected. `scanned_signals` has a single blanket `SELECT` policy for authenticated users, and grades are not part of any policy predicate. No policy changes needed.
- `/performance` dashboard: the "By grade tier" table groups rows dynamically by whatever `grade` values exist, so A+ rows appear automatically with no aggregation change. Only presentational work is needed: a grade colour token, a badge style, and a new "A+ only" option in the Settings minimum-grade select.
- `scanner_settings.min_grade` stays the same enum; the TypeScript rank maps get `"A+": 4`.
- Postgres caveat: a newly added enum value cannot be used by other statements in the same transaction, so the enum change ships as its own migration, separate from any insert that uses it.

### 3. Execution performance in the worker

No meaningful impact. RSI, ATR, an ATR moving average, and order-block sweeps are all single-pass numeric loops over a few hundred numbers — sub-millisecond per timeframe, well under a millisecond of extra CPU per job. The worker's real cost is entirely network: three sequential MetaApi REST fetches per instrument, each capped at 8s. One job per instrument, max 3 jobs per request, unchanged. Order-block detection stays O(n) per timeframe (no nested scans over swing pairs).

## Step 2 — Feasibility of the 4-pillar model

The model is compatible, and it maps cleanly onto structures that already exist — two pillars are already half-built:

| Pillar                  | Current state                                                                  | Work needed                                                 |
| ----------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1. Trend alignment      | Already computed as `allAligned` / `alignmentScore` in `grading.ts`            | Reuse as-is, expose as a pillar                             |
| 2. Order block retest   | Not built. Point C exists in `detectAbc`; `atPointC` is a crude midpoint proxy | New H1/H4 order-block detector + containment test           |
| 3. Momentum exhaustion  | Not built. No RSI in `indicators.ts`                                           | Add RSI + divergence check at Point C                       |
| 4. Volatility expansion | Partly built. Confidence uses an M15/H1 ATR _ratio_, not ATR vs its own MA     | Add ATR moving average, switch the test to ATR ≥ ATR-MA(20) |

Cleaner implementation than a bolt-on, based on the existing structure:

1. Keep the existing tier logic (`A`/`B`/`C`) as the _structural_ grade and layer confluence on top, rather than rewriting `gradeSetup`. A+ is then defined as "grade A **and** all four pillars pass" — a strict superset, so historical A rows remain semantically valid and the performance dashboard stays comparable across time.
2. Persist pillars as four numeric 0–100 columns plus a `pillars_passed` integer, not as booleans. Booleans lose the near-miss information that makes the confidence score meaningful, and numeric columns let `/performance` chart pillar-level predictiveness later.
3. Rebalance the confidence weights once, in one place (`CONFIDENCE_WEIGHTS` in `types.ts`), to 35% trend / 25% order block / 20% momentum / 20% volatility-expansion, and fold R:R in as a multiplier cap rather than a fifth weight. This keeps a single scoring source of truth instead of two competing models.
4. Keep every new indicator in `src/lib/scanner/indicators.ts` as a pure function so it stays unit-testable and free of any server/database import.

### Risks

- Historical comparability: 180 existing signals have no pillar data. The dashboard must treat null pillars as "unscored" rather than zero, or baseline expectancy will look artificially degraded.
- Signal scarcity: A+ requiring all four pillars will be rare (likely a handful per month on three instruments). That is the intent of the No-Trade philosophy, but the feed should not look empty — A/B/C keep flowing.
- Order-block definition is subjective. Proposal: last down-close (for demand) candle preceding an impulsive displacement leg that breaks structure, zone = that candle's body/wick range, invalidated once fully traded through. This will be documented in code so future tuning is unambiguous.
- Enum ordering drift (see above) — mitigated by never comparing grades in SQL.

## Proposed execution plan (pending your approval)

1. Migration A: add `A+` to `signal_grade`.
2. Migration B: add nullable pillar columns to `scanned_signals` (`p_trend`, `p_order_block`, `p_momentum`, `p_volatility_expansion`, `pillars_passed`), plus grants already covered by existing table grants.
3. `indicators.ts`: add `rsi`, `atrSeries`, `atrMovingAverage`, `detectOrderBlocks`, `zoneContains`.
4. `grading.ts`: add `scoreConfluence(h4, h1, m15, abc)` returning the four pillar scores; promote grade A to A+ when all four pass.
5. `profile.ts` / `types.ts`: rebalanced weights, pillar values on `TradeProfile`, pillar sentences added to the qualitative breakdown.
6. `metaapi.server.ts` / `pipeline.server.ts`: fetch 300 candles for H4/H1; persist the new columns.
7. UI: A+ colour token in `styles.css`, `GRADE_STYLES` and rank maps updated (`SignalCard`, `feed`, `alerts.server`), "A+ only" option in Settings, pillar checklist row on the signal card.
8. Verify with a live scan cycle and confirm the feed, alerts and `/performance` render A+ correctly.

## Technical notes

- Files touched: `src/lib/scanner/{indicators,grading,profile,types,metaapi.server,pipeline.server}.ts`, `src/lib/scanner/alerts.server.ts`, `src/components/SignalCard.tsx`, `src/routes/_authenticated/{feed,settings}.tsx`, `src/styles.css`.
- No RLS or grant changes required.
- No change to the cron/queue architecture, the `CRON_SECRET` gate, or the 8s MetaApi abort behaviour.

&nbsp;

The audit report is approved! Please proceed with the proposed execution plan:

1. Run Migration A (add 'A+' to signal_grade enum) and Migration B (add pillar columns to scanned_signals).

2. Upgrade candle history fetches to 300 for H4 and H1 in metaapi.server.ts.

3. Add pure indicator functions (RSI, ATR MA, Order Block detection) to indicators.ts.

4. Integrate the 4-pillar confluence scoring into grading.ts and promote Grade A to A+ when all 4 pillars pass.

5. Update types, confidence weighting, UI badges/styles, and the Settings minimum-grade filter.

6. Run a live scan cycle to verify end-to-end data parsing and feed/performance rendering.
