# Signals and grades

## Purpose

Define what a published setup contains, how its grade is assigned, and how its
lifecycle ends.

## Current behaviour

### Grading

Active production is `ACTIVE_MODEL_VERSION = 1`. V1 is a frozen deterministic
OHLC heuristic with known characterised defects; corrected V2/V3 geometry is
research-only and is not published. V1 structures are scored on four rule
pillars, each 0–100, each "passing" at 60 (`PILLAR_PASS_SCORE`):

| Pillar                | Weight | Meaning                                              |
| --------------------- | ------ | ---------------------------------------------------- |
| Trend                 | 35%    | H4/H1/M15 moving-average stack pointing the same way |
| Order-block heuristic | 25%    | Point C proximity to an OHLC-derived H1/H4 zone      |
| Momentum              | 20%    | M15 RSI extreme or divergence at Point C             |
| Volatility expansion  | 20%    | M15 ATR at or above its 20-period ATR average        |

R:R is **not** a fifth weight. It is applied afterwards as a cap, so a good
structure with a poor payoff cannot score highly.

| Grade | Meaning                                                                            |
| ----- | ---------------------------------------------------------------------------------- |
| `A+`  | A-grade structure with all four pillars satisfied                                  |
| `A`   | Full moving-average alignment across H4/H1/M15 plus V1's recent-range Point-C test |
| `B`   | Any remaining H1 + M15 alignment; V1 does not require the H4 barrier condition     |
| `C`   | Any remaining non-neutral M15 read; not a validated mean-reversion setup           |

V1 `detectAbc` selects A/B swings but defines C as the lowest/highest extreme in
the latest six M15 candles. It does not enforce a retracement band or complete
A→B→C chronology. Its separate timeframe `atPointC` test is a recent-range
midpoint rule, so V1 has two Point-C concepts. The zone pillar is a deterministic
OHLC supply/demand heuristic; it is not evidence of institutional orders or order
flow. V1 grading headroom uses an unbroken-swing measure, while target reach uses
the recent H4 range extreme; these are two different barriers, not one canonical
level.

### Trade plan fields

Planned entry (a limit at V1 Point C, shifted toward the breakout close by a fixed
`0.3×` M15 ATR heuristic during the London/New York overlap; this offset has no
out-of-sample validation); maximum acceptable entry (slippage ceiling — `0.15R` normally,
`0.10R` on thin extensions where `maxR < 1.5`); planned stop (structural extreme
plus `1.2×` M15 ATR, floored at `0.5×` H1 ATR and at a per-instrument spread
floor); TP1/TP2/TP3 with their **true** R multiples (never assumed to be 1/2/3);
`maxR`, the maximum reachable R before V1's recent 60-bar H4 range extreme; a `capped` flag
when `maxR` rather than the 1:3 default sets the final target; R:R; pattern
symmetry; confidence breakdown; and a qualitative breakdown naming the rules
satisfied or violated.

Rejection rules: risk wider than `3×` M15 ATR is a No-Trade. Reachable R below
`1.0` is not published at all.

### Lifecycle

`active` → resolved (target or stop) or `expired`. An unfilled pending order is
cancelled after `ORDER_TIF_MINUTES` (30 minutes = two M15 candles), because after
that the market is no longer the one that was graded. An `active` signal older
than `SIGNAL_MAX_AGE_HOURS` (24) is swept to `expired` at the start of the next
cycle. Retention for display is `RETENTION_HOURS`: A+/A 48h, B 36h, C 24h.

De-duplication: instrument + direction + entry price rounded to
`ENTRY_PRICE_DECIMALS` (5) forms a structure key, and a structure may not
republish within `STRUCTURE_COOLDOWN_MINUTES` (120) even once retired.

## Inputs

Candles per timeframe, computed indicators, and the timeframe reads
(`bias`, `barrierDistanceAtr`, `atr`, `rangeHigh`/`rangeLow`, `atPointC`).

## Outputs

One `scanned_signals` row per surviving structure, stamped with
`ACTIVE_MODEL_VERSION` (currently 1, "V1 production engine").

## Provenance

Every field is derived from broker candles by the versioned rules. Nothing is
user-supplied, but grades, zones, barriers and confidence are heuristic estimates,
not observed institutional activity.

## Failure behaviour

If a structure cannot reach a third target before V1's range-extreme barrier, `tp3` and
`tp3R` are `null` rather than fabricated. If risk or reachable R fails a
threshold, no signal is created.

## User-facing meaning

Grade = how completely the structure satisfied the rules. Confidence = a
deterministic score from that same rule set. **Neither is a probability that the
trade will win.**

## What a signal does not guarantee

That it will fill, that the plan will be reachable at your broker's spread, or
that TP2/TP3 will be managed by anything other than you.

## Implementation

`src/lib/scanner/grading.ts`, `profile.ts`, `types.ts`,
`src/lib/scanner/strategy-manifest.ts`, `src/lib/db-types.ts`.

## Tests

`src/lib/scanner/__tests__/grading.test.ts`, `profile.test.ts`,
`src/lib/__tests__/versioning.test.ts`.
