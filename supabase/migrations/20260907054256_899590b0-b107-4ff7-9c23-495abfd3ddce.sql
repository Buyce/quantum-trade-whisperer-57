-- 1. Identity: one row per (signal, replay version, execution policy).
ALTER TABLE public.shadow_executions DROP CONSTRAINT shadow_executions_signal_id_key;

CREATE UNIQUE INDEX shadow_executions_signal_replay_policy_key
  ON public.shadow_executions (signal_id, replay_version, execution_policy);

-- 2. Backfill the missing Replay-V2 siblings for production rows still inside the
--    provider's M15 depth (200 bars ~= 50 hours). Older rows can never be
--    replayed, so a sibling for them would only sit pending forever.
INSERT INTO public.shadow_executions (
  plan_id, replay_version, execution_policy, cohort,
  signal_id, instrument, grade, direction, detected_at,
  entry_price, stop_loss, tp1, tp2, tp3,
  tp1_r, tp2_r, tp3_r, max_r, risk_price, atr,
  confidence_score, trading_session, volatility_index,
  model_version, observation_key, strategy_family, quality_grade,
  entry_source, stop_anchor,
  status, replay_cursor, bars_replayed
)
SELECT
  v1.plan_id, 2, 'single_exit_first_target', v1.cohort,
  v1.signal_id, v1.instrument, v1.grade, v1.direction, v1.detected_at,
  v1.entry_price, v1.stop_loss, v1.tp1, v1.tp2, v1.tp3,
  v1.tp1_r, v1.tp2_r, v1.tp3_r, v1.max_r, v1.risk_price, v1.atr,
  v1.confidence_score, v1.trading_session, v1.volatility_index,
  v1.model_version, v1.observation_key, v1.strategy_family, v1.quality_grade,
  v1.entry_source, v1.stop_anchor,
  'pending', v1.detected_at, 0
FROM public.shadow_executions v1
WHERE v1.replay_version = 1
  AND v1.cohort = 'production'
  AND v1.detected_at > now() - interval '2 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.shadow_executions s2
     WHERE s2.plan_id = v1.plan_id
       AND s2.replay_version = 2
       AND s2.execution_policy = 'single_exit_first_target'
  )
ON CONFLICT DO NOTHING;

-- 3. Clear the research error counter, keeping a note of what it was.
UPDATE public.shadow_engine_state
   SET research_errors = 0,
       research_last_error = left(
         'cleared after fixing replay-v2 sibling identity; previous: '
         || coalesce(research_last_error, 'none'), 500),
       research_last_error_at = now(),
       updated_at = now()
 WHERE id;