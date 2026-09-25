INSERT INTO public.execution_control_changes (changed_by, reason, control_key, old_value, new_value)
SELECT 'boatengampomah@gmail.com', 'owner enabled live without dry run', k, 'false'::jsonb, 'true'::jsonb
FROM unnest(ARRAY['live_confirm_enabled','live_auto_enabled','customer_live_confirm_enabled','customer_live_auto_enabled']) AS k;
UPDATE public.execution_controls
   SET live_execution_enabled = true, live_confirm_enabled = true, live_auto_enabled = true,
       customer_live_confirm_enabled = true, customer_live_auto_enabled = true,
       live_kill_switch_reason = NULL, updated_at = now()
 WHERE id = true;