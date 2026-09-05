-- 1. Drawdown brakes into force for the owner only, using the built-in safe
--    defaults. Other users keep their own (off) settings.
UPDATE public.scanner_settings
   SET drawdown_brakes_enabled = true,
       daily_loss_limit_percent = 3,
       weekly_loss_limit_percent = 6,
       consecutive_loss_limit = 4,
       max_drawdown_percent = 10,
       updated_at = now()
 WHERE user_id = 'f00b3e3c-2d80-42b5-b63f-df136d38c870'::uuid;

-- 2. Research-only Replay V2 shadow pass ON, so production setups get a V2
--    sibling and a recorded post-fill path. Live exit policy is unchanged.
UPDATE public.shadow_engine_state
   SET replay_v2_shadow_enabled = true,
       updated_at = now()
 WHERE id = true;

-- 3. Close the live door. Real-money execution must be re-armed deliberately.
UPDATE public.execution_controls
   SET live_execution_enabled = false,
       live_auto_enabled = false,
       updated_at = now()
 WHERE id = true;

INSERT INTO public.execution_control_changes (changed_by, reason, control_key, old_value, new_value, evidence)
VALUES
  ('migration:close-live-door', 'live switches were left on with no broker-confirmed real account; re-arming must be deliberate',
   'execution.live_execution_enabled', 'true'::jsonb, 'false'::jsonb, '{}'::jsonb),
  ('migration:close-live-door', 'live switches were left on with no broker-confirmed real account; re-arming must be deliberate',
   'execution.live_auto_enabled', 'true'::jsonb, 'false'::jsonb, '{}'::jsonb);