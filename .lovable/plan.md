# Prompt 4C — V3 Geometry Research Model (plan only)

Corrections accepted in full. V2 is immutable and is not touched. Prompt 4's corrected geometry becomes **model version 3**. V1 stays frozen production. No implementation in this turn.

## 1. Cohort architecture

```text
V1  production      frozen        publishes signals, alerts, MCP, feed
V2  canonical ABC   frozen        research only (registered manifest + hash, Prompt 3)
V3  geometry        new research   canonical ABC (inherits V2) + corrected entry/stop/target
```

- V3 rows are `shadow_executions.model_version = 3`, `signal_id = NULL`, plus `model_observations` at `model_version = 3`. Observation identity stays `(run_id, instrument, model_version)`, so V1/V2/V3 each get one row per instrument per cycle and never collide.
- No historical V2 row is mutated, relabelled or recomputed. No unversioned "variant" field is added anywhere.
- The multi-arm offset experiment is **out of scope for Prompt 4**. V3 has exactly one entry rule (below). Any offset arm gets its own immutable model version in a later prompt.

## 2. What V3 inherits vs. changes

**Inherits V2 unchanged** (explicitly not presented as new work): canonical ABC / Point C selection (`v2/pointc.ts`, band 0.382–0.886, single deterministic pass), the canonical bounded H4 barrier (`v2/barrier.ts`, one definition for grade headroom and the R cascade, `OPEN_SPACE_EXTENSION_ATR = 6`), V2 pillars and grading, the shared candle snapshot semantics, and the adaptive TP-ladder shape.

**V3 changes, three of them, all deterministic and parameter-locked in this plan:**
1. Leg-scoped stop anchor (replaces `slice(-10)`).
2. Slippage-ceiling mathematics (replaces the constant 0.15R / 0.10R tolerance).
3. Entry rule: **structural Point C only. No session offset in V3.** V1 keeps its live 0.3 ATR overlap offset untouched; the offset question moves to its own versioned experiment.

**Not in V3:** broker specification. See section 6.

## 3. V3 stop anchor — exact definition

Uses the indices `detectAbcV2` already returns (`bIndex`, `cIndex`).

- Window: `candles[bIndex + 1 .. cIndex]` — start exclusive of B's bar, end **inclusive** of C's bar.
- Long: `anchor = min(low)` over the window. Short: `anchor = max(high)` over the window.
- Buffer is unchanged from V1/V2: `buffer = max(1.2 × M15 ATR, 0.5 × H1 ATR, SPREAD_FLOOR[instrument] ?? DEFAULT_SPREAD_FLOOR)`.
- Long: `stop = anchor − buffer`. Short: `stop = anchor + buffer`.
- Forming bar: C is selected from bars strictly after B in the delivered snapshot, and that snapshot includes the forming bar (documented in `docs/CHARACTERISATION.md`). So the forming bar **can** be C and can participate in the anchor window. No new snapshot semantics are introduced.
- Insufficient data: `cIndex <= bIndex`, empty window, or fewer candles than `detectAbcV2` requires → `no_trade` ("leg window not measurable"). No fallback to a bar-count window.
- Malformed: any non-finite open/high/low/close in the window, non-finite ATR, or `buffer` not `> 0` → `no_trade`. Never a substituted default.
- Risk guards unchanged: `risk = |entry − stop|` must be `> 0` and `<= MAX_RISK_ATR × M15 ATR`, else `no_trade`.

Property tests: for every generated bullish/bearish case that returns a profile — `long ⇒ stop < entry`, `short ⇒ stop > entry`; `risk` finite and `> 0`; `stop` is beyond the leg extreme by at least `buffer`; anchor is within the declared index window; a case where C is 14 bars back yields a different (leg-scoped) anchor than the last-10 rule, and a case where C is the recent extreme yields the same one.

## 4. V3 slippage ceiling — locked mathematics

Definitions: planned terminal target `k` (in R), adverse entry displacement `d` (in R of the planned risk).

- `actualRR = (k − d) / (1 + d)`
- `dMax = (k − m) / (1 + m)` where `m` is the minimum permissible terminal payoff.

Locked V3 rules (no parameter chosen at implementation time):
- **`m = 2.0`** when the ladder has a TP3 (`k = tp3R`); **`m = 1.0`** when TP3 is null / thin ladder (`k = tp2R`).
- Absolute cap: `d = min(dMax, 0.15)`. The V1 constant becomes the hard ceiling so V3 can never be more permissive than production.
- `k <= m` → `d = 0`: the ceiling equals the entry price exactly; the setup is "limit only, no market entry". Not a no-trade, and never a negative `d`.
- Price conversion: long `ceiling = entry + d × risk`; short `ceiling = entry − d × risk`.
- Non-finite `k`, `m`, `risk` or resulting price → fail closed: no ceiling is written and the row is `no_trade` rather than carrying an invented number.

Worked fixtures: `k=3, m=2 → dMax = 1/3 → d = 0.15`, `actualRR = 2.478`. `k=2.4, m=2 → dMax = 0.1333 → d = 0.1333`, `actualRR = 2.0`. `k=1.02, m=1 → dMax = 0.01 → d = 0.01`, `actualRR = 1.0`. `k=0.9, m=1 → d = 0`. Long `E=1.1000, S=1.0980, risk=0.0020, d=0.15 → 1.10030`; short mirror `→ 1.09970`.

## 5. Historical miss-distance data — hypothesis only

The `never_filled` miss distribution (n=223; p25/p50/p75 = 0.707 / 1.500 / 2.281 ATR; 16 rows ≤0.3 ATR) is conditioned on non-fills and is therefore an ex-post, selection-biased sample. It may generate a hypothesis and nothing else. If a quantile offset is ever tested it will be a separate model version with: a fixed historical training cutoff, computed once, dataset window / sample size / exact formula recorded, the resulting offset frozen in that version's manifest, judged only on prospective observations after the cutoff, and never recomputed from accumulating test outcomes.

## 6. Broker specification — research spike, not a V3 dependency

V3 ships with the existing static `SPREAD_FLOOR` table only. Before any broker floor participates in grading or stop validation, a separate spike reports: exact MetaApi endpoint; exact returned fields for XAUUSD, GBPAUD, EURUSD; whether `stopsLevel`, tick size, contract size and volume constraints are actually present; units of every field; whether values are account/broker specific; request latency; caching validity/staleness; incremental API-call volume. Until that report exists there is **no** "spec unavailable ⇒ no trade" rule. If the spike succeeds and a later model version uses it, the detected-time specification (or a stable spec-version hash) is stored with the shadow observation so a broker configuration change cannot silently alter what that model version means.

## 7. Database and code changes

- Additive migration only: register a `model_versions` row for version 3 with its own manifest hash (`v3-corrected-geometry-research`), extend the existing `shadow_executions` / `model_observations` model-version CHECKs to admit 3, and add nullable provenance columns `entry_source` and `stop_anchor` (no defaults, V1/V2 rows stay NULL). Grants unchanged; research tables remain service-role only.
- New code under `src/lib/scanner/v3/` (manifest, profile) importing V2's pointc/barrier/pillars/grading unchanged. New shared, tested slippage module used by V3 only; V1's `profile.ts` and `db-types.ts` values are untouched.
- Enrolment reuses the existing `enrol.server.ts` shape with `model_version = 3`, gated by its own kill switch column on `shadow_engine_state` (`v3_enabled`, default false) and by `claim_v2_structure(model_version, structure_key)` — which is already model-version-keyed, so V2 and V3 claim independently.
- Admin comparison panel exposes per-version sample counts and outcomes for V1/V2/V3 separately. "Shadow" is never a collapsed bucket.

## 8. Copy correction (explicitly permitted)

The statement "0.15R turns a 1:3 into ~1:2.55" is wrong; correct value 2.478. This prose is corrected in `types.ts`, `SignalCard.tsx` and `signal-alert.tsx`. V1 numeric fields, eligibility and payload field values are unchanged; email prose intentionally changes, so no byte-identical claim is made about emails.

## 9. Acceptance criteria

- No change to V1 numerical trading fields, V1 eligibility, or V1 entry / stop / TP / `max_acceptable_entry` values.
- No new live alerts, push, email or webhook sends; no change to MCP field values or contracts.
- Copy-only correction from the incorrect arithmetic is explicitly permitted and is the sole user-visible V1 change.
- **Deterministic semantic equality** on a pinned candle set for V1: trade/no-trade, grade, direction, entry, stop, every TP, `maxR`, max acceptable entry, structure key, pillars/confluence — exact equality, ignoring timestamps, ids and the approved copy correction.
- V3 emits provenance-stamped research rows only, unreachable from feed, alerts and MCP; V1/V2/V3 cohorts isolated in every read path and in `regime_stats`.
- Full test matrix green: unit (slippage fixtures above, ladder `1.02→[0.61,1.02,null]`, `1.6→[0.8,1.2,1.6]`, `3.4→[1,2,3]`), property (stop side/finiteness, barrier single-definition, bounded `maxR`), integration, DB/RLS, regression, failure injection (MetaApi timeout, duplicate job, concurrent claim of one structure, partial insert, stale run id), and end-to-end no-leak checks.

## 10. Promotion gates (n=150 is a floor, not a threshold)

Promotion of V3 over V1 requires all of: ≥150 resolved prospective V3 rows as a minimum evidence floor; an effect size stated in mean R with its uncertainty interval; matched-cohort comparison (same instrument × session × volatility bucket); clustering/autocorrelation treatment (overlapping structures on one instrument are not independent — cluster by instrument-day); drawdown and tail-risk checks (worst run of losses, max adverse excursion); and prospective-only outcomes after the V3 registration timestamp. Failing any one gate means no promotion, regardless of headline win rate.

## 11. Baseline (measured, with gaps stated)

Frozen-V1 baseline to pin in `baseline_snapshots`: 169 signals (2026-08-11 → 08-21); direction 154 long / 15 short; resolved shadow rows 311 with 88 filled (28.3%) and 223 never filled; grade mix on resolved rows A 3 / B 235 / C 73; `max_r` mean 3.89, min 1.02, max 42.39; 30 signals with `maxR < 1.5`; miss-distance quartiles as above; per-session fill counts (london 23/59, tokyo 22/72, new_york 10/44, sydney 14/37, overlap 1/10, unlabelled 18/89); plus p95 scan latency, queue failure rate, alert and webhook counts, duplicate-suppression counts.

**Not calculable and not fabricated:** any session-conditioned offset estimate (overlap n=10; 89 resolved rows carry a NULL session); all V2 outcomes (`model_version = 2` currently has **0** resolved rows); all V3 outcomes.

## 12. Rollback

`v3_enabled = false` stops enrolment instantly; the V3 model row and nullable columns are additive so no collected data is destroyed; the copy correction reverts by text edit. V1 has no flag because V1 does not change. No migration rewrites or deletes historical observations.

## 13. Remaining risks and what cannot be guaranteed

Open risks: V3 may publish fewer or more research candidates than V2 (expected, measured, not a regression); overlap-session scarcity may leave the offset question undecided indefinitely; broker-spec availability is unverified until the spike; replay-derived R and user-reported R can disagree (pre-existing).

Cannot be guaranteed: that corrected geometry improves fill rate or net expectancy; that enough prospective samples accumulate in a useful timeframe; that broker `stopsLevel` is surfaced identically across all three instruments; that historical labels stay comparable if the broker revises feed history.

Recommendation: proceed as specified — V1 frozen, V2 immutable, V3 as the single-geometry research model, offset experiment deferred to its own versioned prompt.
