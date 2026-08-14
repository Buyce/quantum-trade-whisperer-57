ALTER TABLE public.scanned_signals
  ADD COLUMN IF NOT EXISTS structure_key text,
  ADD COLUMN IF NOT EXISTS tp1_r numeric,
  ADD COLUMN IF NOT EXISTS tp2_r numeric,
  ADD COLUMN IF NOT EXISTS tp3_r numeric,
  ADD COLUMN IF NOT EXISTS max_r numeric,
  ALTER COLUMN tp3 DROP NOT NULL;

DROP INDEX IF EXISTS public.scanned_signals_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS scanned_signals_active_structure
  ON public.scanned_signals (structure_key)
  WHERE status = 'active' AND structure_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS scanned_signals_structure_recent
  ON public.scanned_signals (structure_key, detected_at DESC)
  WHERE structure_key IS NOT NULL;