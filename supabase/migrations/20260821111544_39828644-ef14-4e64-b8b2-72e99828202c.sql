-- V3 corrected-geometry research model.
-- Additive and dark by default. No V1 or V2 behaviour, grading, risk or replay
-- semantics change; nothing here is published to users.

-- 1. Kill switch for V3 shadow enrolment.
ALTER TABLE public.shadow_engine_state
  ADD COLUMN IF NOT EXISTS v3_enabled boolean NOT NULL DEFAULT false;

-- 2. Geometry provenance on shadow rows. Nullable, no default: V1/V2 rows stay
--    unlabelled so historical cohorts are not retro-stamped.
ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS entry_source text,
  ADD COLUMN IF NOT EXISTS stop_anchor text;

ALTER TABLE public.shadow_executions
  DROP CONSTRAINT IF EXISTS shadow_executions_entry_source_check;
ALTER TABLE public.shadow_executions
  ADD CONSTRAINT shadow_executions_entry_source_check
  CHECK (entry_source IS NULL OR entry_source IN ('structural', 'dynamic_offset'));

ALTER TABLE public.shadow_executions
  DROP CONSTRAINT IF EXISTS shadow_executions_stop_anchor_check;
ALTER TABLE public.shadow_executions
  ADD CONSTRAINT shadow_executions_stop_anchor_check
  CHECK (stop_anchor IS NULL OR stop_anchor IN ('retracement_leg', 'recent_window'));

-- 3. Immutable manifest for research model version 3. The hash is the
--    deterministic FNV-1a/64 digest of the frozen parameter set in
--    src/lib/scanner/v3/manifest.ts, so a snapshot taken later is reproducible.
INSERT INTO public.model_versions (version, label, components, code_hash, notes)
VALUES (
  3,
  'v3-corrected-geometry-research',
  '{"pointC":{"retracementMin":0.382,"retracementMax":0.886,"pivotLookback":2,"selection":"most-recent-B, nearest-preceding-A, single deterministic pass","inheritedFrom":"v2"},"barrier":{"h4PivotLookback":5,"pivotMinSeparationAtr":0.3,"openSpaceExtensionAtr":6,"usage":"single barrier for both grade headroom and the R cascade","inheritedFrom":"v2"},"pillars":{"zoneMaxDistanceAtr":1.5,"zoneNormalisation":"native-timeframe Wilder ATR at the zone bar (prefix-only)","volatility":{"passRatio":1,"passScore":60,"saturationRatio":1.6,"saturationScore":100},"inheritedFrom":"v2"},"stop":{"window":"(bIndex + 1) .. cIndex inclusive — the retracement leg only","m15AtrMultiplier":1.2,"h1AtrFloor":0.5,"spreadFloor":"per-instrument SPREAD_FLOOR, DEFAULT_SPREAD_FLOOR fallback","inheritedFrom":"v1"},"entry":{"rule":"structural-entry-only: the canonical Point C price, exactly","dynamicOffset":"disabled — V3 never shifts the limit off Point C"},"slippage":{"minRatioFull":2,"minRatioThin":1,"capR":0.15,"formula":"d = min(r*(k-m)/(1+m), r*t); k <= m => d = 0","targetsPreserved":true},"risk":{"maxRiskAtr":3,"minReachableR":1,"stopM15AtrMultiplier":1.2,"stopH1AtrFloor":0.5,"inheritedFrom":"v1"},"targetLadder":{"full":"maxR >= 3 => [1, 2, 3]","mid":"1.5 <= maxR < 3 => [0.5, 0.75, 1.0] x maxR","thin":"maxR < 1.5 => [0.6, 1.0] x maxR, TP3 null","inheritedFrom":"v1"},"policy":{"published":false,"shadowEnrolled":"continuation family only, gated by shadow_engine_state.v3_enabled","meanReversion":"observation only","candleSnapshot":"identical MetaApi snapshot as V1, forming bar included","formingCandleAssumption":"the last M15 bar is in progress and is evaluated as-is, exactly as V1/V2 do","priors":"never contributes to regime_stats or any live prior"}}'::jsonb,
  '3c327b029da38563',
  'Geometry-correction research cohort: leg-scoped stop (B+1..C), structural entry only, target-preserving slippage ceiling. Research only; never feeds regime_stats or published signals.'
)
ON CONFLICT (version) DO UPDATE
  SET label = EXCLUDED.label,
      components = EXCLUDED.components,
      code_hash = EXCLUDED.code_hash,
      notes = EXCLUDED.notes;