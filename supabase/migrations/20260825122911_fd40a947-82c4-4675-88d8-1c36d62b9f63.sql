ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS auto_execute_c_grade boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.scanner_settings.auto_execute_c_grade IS
  'Owner opt-in: may C-grade setups become automatic orders. Default false preserves the historical unconditional refusal. Every other execution gate still applies.';