# V3 Geometry Research Model

Isolate the approved geometry corrections in a new research model (version 3). V1 stays frozen — production entries, stops, targets, the status-quo dynamic offset and the V1 learning priors are not touched. V2 behaviour is unchanged.

## What gets built

1. **Model registry and schema**
   - Register model version 3 in `model_versions` with the immutable manifest hash.
   - Allow `model_version = 3` on research writes; add nullable `entry_source` and `stop_anchor` columns to `shadow_executions` so a V3 row records how its entry and stop were derived.
   - Add `v3_enabled` kill switch (default false) to `shadow_engine_state`.

2. **V3 geometry module (`src/lib/scanner/v3/`)**
   - `stop.ts` — leg-scoped stop: anchor on the extreme of bars `bIndex + 1 .. cIndex` inclusive (the retracement leg only), with V1's buffer constants inherited unchanged (1.2x M15 ATR, 0.5x H1 ATR floor, per-instrument spread floor). Returns null on an empty window; never falls back to another window.
   - `slippage.ts` — target-preserving ceiling: `d = min(r*(k-m)/(1+m), r*t)`, with `m = 2.0` when TP3 exists and `m = 1.0` on thin extensions, `t = 0.15`, and `k <= m => d = 0` (limit-only).
   - `profile.v3.ts` — structural entry only (canonical Point C, no session offset), V2's Point C detector, unified H4 barrier, V2 pillars and grading, V1 TP ladder and risk ceilings, V3 stop and V3 slippage.
   - `manifest.ts` — frozen provenance covering every V3 semantic: the B+1→C stop window, structural-entry-only rule, inherited stop constants, slippage `m` values, the 0.15R cap, the `k <= m => d = 0` rule, the TP ladder, barrier inheritance, the forming-candle assumption, and a deterministic hash of that parameter set.

3. **Pipeline and research plumbing**
   - Evaluate V3 in the existing research block of `pipeline.server.ts`, on the same candle snapshot, inside its own try/catch; evaluator crashes persist as `decision = 'error'` observations.
   - Generalise the structure claim and observation-row helpers so V3 claims its own cooldown per `(model_version, structure_key)`; V2 call sites keep identical behaviour.
   - Enrol continuation-family V3 candidates as `model_version = 3` shadow rows only when `v3_enabled` is true and the claim was won. Mean reversion stays observation-only.
   - Research isolation: `recompute_regime_stats` stays pinned to model version 1, and V2/V3 statistics are read only from `model_observations` and `shadow_executions`. No research row ever feeds live priors, published signals, alerts, push, email, webhooks or MCP.

4. **Admin visibility**
   - The research ledger already groups by model version, so V3 appears as its own cohort; extend the paired-decision comparison to include V3 against V1 on the shared observation key.

5. **Copy correction (UI/comments only, no math change)**
   - V1's slippage note claims 0.15R turns 1:3 into ~1:2.55. The correct figure is 2.478. Fix the wording only; the V1 ceiling formula stays exactly as it is.

## Tests

- Characterization: `maxR = 1.6` with `m = 2.0` yields `d = 0`, i.e. a limit-only entry under the locked V3 slippage rule.
- Characterization: `E = 1.1000`, `S = 1.0980`, `k = 3`, `t = 0.15` yields ceiling `1.10030` and a realised ratio of `2.478`.
- Leg-scoped stop: anchor comes only from `bIndex + 1 .. cIndex`; bars outside the leg cannot move it; empty window returns null.
- Manifest hash stability, and a guard that V1 and V2 outputs are byte-identical before and after this change.
- DB regression: `model_version = 3` rows accepted, `recompute_regime_stats(1)` leaves V2/V3 rows untouched.

## Technical notes

- V3 is research-only and dark by default: with `v3_enabled = false` it produces observations and no shadow rows.
- Research writes remain deadline-bounded and failure-tolerant; a V3 fault records durable research health and never changes the V1 job result.
- V3 shares the replay engine; the resolver's per-version budget already reads production first and gives research cohorts only the leftover allowance.
