ALTER TABLE public.shadow_executions
  ADD COLUMN IF NOT EXISTS post_entry_path jsonb;

COMMENT ON COLUMN public.shadow_executions.post_entry_path IS
  'Research only: ordered post-fill bar path in R units {bars:[{t,hR,lR,amb}],targetsR:[],truncated:bool}. Written by Replay V2 resolution; never used by production labelling.';

CREATE TABLE IF NOT EXISTS public.exit_variant_results (
  variant text PRIMARY KEY,
  replay_version smallint NOT NULL,
  execution_policy text NOT NULL,
  samples integer NOT NULL DEFAULT 0,
  undecidable integer NOT NULL DEFAULT 0,
  clusters integer NOT NULL DEFAULT 0,
  mean_r numeric,
  baseline_mean_r numeric,
  delta_r numeric,
  holdout_confirmed boolean NOT NULL DEFAULT false,
  holdout_delta_r numeric,
  holdout_low numeric,
  holdout_high numeric,
  split_day text,
  train_days integer NOT NULL DEFAULT 0,
  holdout_days integer NOT NULL DEFAULT 0,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail text NOT NULL DEFAULT '',
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.exit_variant_results TO service_role;

ALTER TABLE public.exit_variant_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read exit variant results"
  ON public.exit_variant_results
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE TRIGGER exit_variant_results_touch
  BEFORE UPDATE ON public.exit_variant_results
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();