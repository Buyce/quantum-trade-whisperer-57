ALTER TABLE public.scanned_signals
  ADD COLUMN IF NOT EXISTS prior_filled_n integer,
  ADD COLUMN IF NOT EXISTS prior_tier smallint;

COMMENT ON COLUMN public.scanned_signals.prior_filled_n IS
  'Filled shadow samples behind p_win_prior at detection time. Null for signals published before this column existed; never backfilled.';
COMMENT ON COLUMN public.scanned_signals.prior_tier IS
  'Regime tier that answered the prior lookup (3 = exact regime, 2 = instrument+direction, 1 = global). Null when no prior was available.';