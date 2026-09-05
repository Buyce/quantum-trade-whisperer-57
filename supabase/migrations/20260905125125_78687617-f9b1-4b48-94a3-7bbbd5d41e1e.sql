UPDATE public.shadow_executions
SET research_window_status = NULL
WHERE cohort = 'research_candidate'
  AND status IN ('pending', 'open')
  AND research_window_status = 'outside_replay_window';

UPDATE public.shadow_engine_state
SET research_last_error = NULL
WHERE id = true
  AND research_last_error LIKE '%DELETE requires a WHERE clause%';