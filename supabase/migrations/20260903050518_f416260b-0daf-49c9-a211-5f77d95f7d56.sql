CREATE TABLE public.instrument_symbol_bindings (
  canonical text PRIMARY KEY,
  provider_symbol text NOT NULL,
  bound_by text NOT NULL,
  reason text,
  candidates text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.instrument_symbol_bindings TO service_role;

ALTER TABLE public.instrument_symbol_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages symbol bindings"
  ON public.instrument_symbol_bindings
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER instrument_symbol_bindings_touch
  BEFORE UPDATE ON public.instrument_symbol_bindings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.broker_symbol_specs
  ADD COLUMN IF NOT EXISTS provider_symbol text;