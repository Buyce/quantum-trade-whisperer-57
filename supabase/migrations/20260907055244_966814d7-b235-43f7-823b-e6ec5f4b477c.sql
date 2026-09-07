ALTER TABLE public.execution_controls
  ADD CONSTRAINT execution_controls_execution_policy_check
  CHECK (execution_policy IN (
    'single_exit_first_target',
    'single_exit_second_target',
    'single_exit_third_target'
  ));