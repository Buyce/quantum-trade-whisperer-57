ALTER TABLE public.scanner_settings DROP CONSTRAINT IF EXISTS scanner_settings_auto_exit_policy_check;
ALTER TABLE public.scanner_settings ADD CONSTRAINT scanner_settings_auto_exit_policy_check
  CHECK (auto_exit_policy = ANY (ARRAY[
    'single_exit_first_target','single_exit_second_target','single_exit_third_target',
    'partial_tp1_runner_tp2','ladder_tp1_tp2_runner_tp3']));

ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS auto_exit_shares text NOT NULL DEFAULT 'half_runner',
  ADD COLUMN IF NOT EXISTS auto_exit_trail_runner boolean NOT NULL DEFAULT false;

ALTER TABLE public.scanner_settings DROP CONSTRAINT IF EXISTS scanner_settings_auto_exit_shares_check;
ALTER TABLE public.scanner_settings ADD CONSTRAINT scanner_settings_auto_exit_shares_check
  CHECK (auto_exit_shares = ANY (ARRAY['half_runner','thirds','quarter_half_quarter']));

ALTER TABLE public.position_management_state
  ADD COLUMN IF NOT EXISTS second_partial_volume numeric,
  ADD COLUMN IF NOT EXISTS second_partial_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS second_partial_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS second_partial_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS second_partial_detail text,
  ADD COLUMN IF NOT EXISTS runner_stop_target numeric,
  ADD COLUMN IF NOT EXISTS runner_stop_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS runner_stop_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS runner_stop_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS runner_stop_detail text,
  ADD COLUMN IF NOT EXISTS best_price numeric,
  ADD COLUMN IF NOT EXISTS trail_stop_target numeric,
  ADD COLUMN IF NOT EXISTS trail_moves integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trail_detail text;

ALTER TABLE public.position_management_state DROP CONSTRAINT IF EXISTS position_management_second_partial_state_check;
ALTER TABLE public.position_management_state ADD CONSTRAINT position_management_second_partial_state_check
  CHECK (second_partial_state = ANY (ARRAY['pending','attempted','confirmed','refused','unknown','not_applicable']));

ALTER TABLE public.position_management_state DROP CONSTRAINT IF EXISTS position_management_runner_stop_state_check;
ALTER TABLE public.position_management_state ADD CONSTRAINT position_management_runner_stop_state_check
  CHECK (runner_stop_state = ANY (ARRAY['pending','attempted','confirmed','refused','unknown','not_applicable']));