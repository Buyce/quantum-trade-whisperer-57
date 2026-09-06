ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS auto_intel_min_expected_r numeric;

COMMENT ON COLUMN public.scanner_settings.auto_intel_min_expected_r IS
  'Optional minimum expected R per published plan (mean_r_per_plan, replay-derived) that a cohort must show before an automatic order is queued. NULL = not configured; the expected-R leg of the intelligence gate refuses nothing.';