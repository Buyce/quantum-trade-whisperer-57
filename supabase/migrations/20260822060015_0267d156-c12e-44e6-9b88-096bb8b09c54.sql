CREATE TABLE public.broker_symbol_specs (
  symbol text PRIMARY KEY,
  contract_size numeric,
  tick_size numeric,
  tick_value numeric,
  volume_min numeric,
  volume_max numeric,
  volume_step numeric,
  volume_limit numeric,
  stops_level numeric,
  freeze_level numeric,
  digits numeric,
  base_currency text,
  profit_currency text,
  margin_currency text,
  trade_mode text,
  calc_mode text,
  raw jsonb,
  source text NOT NULL DEFAULT 'metaapi_specification',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.broker_symbol_specs TO authenticated;
GRANT ALL ON public.broker_symbol_specs TO service_role;
ALTER TABLE public.broker_symbol_specs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read broker symbol specs"
ON public.broker_symbol_specs FOR SELECT TO authenticated USING (true);

CREATE TABLE public.sizing_divergence_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument text NOT NULL,
  signal_id uuid REFERENCES public.scanned_signals(id) ON DELETE SET NULL,
  user_id uuid,
  authoritative_model smallint NOT NULL,
  spec_source text NOT NULL,
  v1_lots numeric,
  v2_lots numeric,
  v1_reason text,
  v2_reason text,
  lots_delta numeric,
  risk_delta numeric,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sizing_divergence_log_created_idx ON public.sizing_divergence_log (created_at DESC);

GRANT ALL ON public.sizing_divergence_log TO service_role;
ALTER TABLE public.sizing_divergence_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS equity_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS risk_ack_high boolean NOT NULL DEFAULT false;