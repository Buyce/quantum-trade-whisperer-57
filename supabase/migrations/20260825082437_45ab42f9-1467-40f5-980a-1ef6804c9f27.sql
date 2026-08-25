CREATE TYPE public.instrument_stage AS ENUM ('disabled','data_validation','shadow','signals_only','execution_approved','suspended');

CREATE TABLE public.instrument_lifecycle (
  symbol text PRIMARY KEY,
  stage public.instrument_stage NOT NULL DEFAULT 'disabled',
  wave smallint NOT NULL DEFAULT 1,
  data_health text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.instrument_lifecycle TO service_role;
ALTER TABLE public.instrument_lifecycle ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages instrument lifecycle"
  ON public.instrument_lifecycle FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER instrument_lifecycle_touch
  BEFORE UPDATE ON public.instrument_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.instrument_lifecycle_transitions (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL REFERENCES public.instrument_lifecycle(symbol) ON DELETE CASCADE,
  from_stage public.instrument_stage,
  to_stage public.instrument_stage NOT NULL,
  reason text NOT NULL,
  evidence jsonb,
  strategy_model_version smallint,
  code_hash text,
  approver text,
  rollback_target public.instrument_stage,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX instrument_lifecycle_transitions_symbol_idx
  ON public.instrument_lifecycle_transitions (symbol, created_at DESC);

GRANT SELECT, INSERT ON public.instrument_lifecycle_transitions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.instrument_lifecycle_transitions_id_seq TO service_role;
ALTER TABLE public.instrument_lifecycle_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role reads lifecycle history"
  ON public.instrument_lifecycle_transitions FOR SELECT TO service_role USING (true);
CREATE POLICY "service role appends lifecycle history"
  ON public.instrument_lifecycle_transitions FOR INSERT TO service_role WITH CHECK (true);

CREATE VIEW public.instrument_stages
  WITH (security_invoker = false)
  AS SELECT symbol, stage FROM public.instrument_lifecycle;

GRANT SELECT ON public.instrument_stages TO authenticated;

ALTER TABLE public.execution_controls
  ADD COLUMN IF NOT EXISTS lifecycle_enforced boolean NOT NULL DEFAULT false;

ALTER TABLE public.instrument_health
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_scope text,
  ADD COLUMN IF NOT EXISTS breaker_open_until timestamptz;