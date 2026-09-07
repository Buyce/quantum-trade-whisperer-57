ALTER TABLE public.execution_controls
  ADD COLUMN IF NOT EXISTS max_customer_exit_policy text NOT NULL DEFAULT 'single_exit_third_target';

ALTER TABLE public.execution_controls
  DROP CONSTRAINT IF EXISTS execution_controls_max_customer_exit_policy_check;
ALTER TABLE public.execution_controls
  ADD CONSTRAINT execution_controls_max_customer_exit_policy_check CHECK (
    max_customer_exit_policy = ANY (ARRAY[
      'single_exit_first_target'::text,
      'single_exit_second_target'::text,
      'single_exit_third_target'::text,
      'partial_tp1_runner_tp2'::text
    ])
  );