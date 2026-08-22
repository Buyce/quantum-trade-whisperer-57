ALTER TABLE public.execution_controls
  ADD COLUMN IF NOT EXISTS allowed_live_hosts text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.execution_controls.allowed_live_hosts IS
  'Trusted bridge destinations for LIVE execution. Exact hostname or .suffix for subdomains. Empty means no live destination is trusted (fail closed); dry-run is unrestricted.';