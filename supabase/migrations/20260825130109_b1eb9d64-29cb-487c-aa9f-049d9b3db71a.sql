-- Wave 2 multi-asset foundation. Everything is dark: the four new instruments
-- enter at stage 'disabled' and no schedule, mapping or sampling touches them.

ALTER TABLE public.instrument_spread_samples ADD COLUMN IF NOT EXISTS asset_class text;
ALTER TABLE public.instrument_spread_stats ADD COLUMN IF NOT EXISTS asset_class text;

UPDATE public.instrument_spread_samples
   SET asset_class = CASE WHEN instrument IN ('XAUUSD','XAGUSD') THEN 'metal'
                          WHEN instrument IN ('USOIL','UKOIL') THEN 'energy'
                          WHEN instrument IN ('NAS100') THEN 'index'
                          ELSE 'fx' END
 WHERE asset_class IS NULL;

UPDATE public.instrument_spread_stats
   SET asset_class = CASE WHEN instrument IN ('XAUUSD','XAGUSD') THEN 'metal'
                          WHEN instrument IN ('USOIL','UKOIL') THEN 'energy'
                          WHEN instrument IN ('NAS100') THEN 'index'
                          ELSE 'fx' END
 WHERE asset_class IS NULL;

-- Broker alias discovery evidence. This table RECORDS what the provider said;
-- it never becomes a mapping. A refusal is evidence too, with its exact reason.
CREATE TABLE IF NOT EXISTS public.instrument_alias_discovery (
  id bigserial PRIMARY KEY,
  canonical text NOT NULL,
  asset_class text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('candidate','ambiguous','missing','spec_unusable','trade_mode_unusable','error')),
  provider_symbol text,
  candidates text[] NOT NULL DEFAULT '{}',
  reason text,
  evidence jsonb,
  observed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.instrument_alias_discovery TO service_role;
GRANT SELECT ON public.instrument_alias_discovery TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.instrument_alias_discovery_id_seq TO service_role;
ALTER TABLE public.instrument_alias_discovery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alias discovery is admin readable"
  ON public.instrument_alias_discovery FOR SELECT TO authenticated
  USING (public.is_admin());

-- Which versioned market calendar an instrument is judged against.
CREATE TABLE IF NOT EXISTS public.instrument_calendar_bindings (
  symbol text PRIMARY KEY,
  asset_class text NOT NULL,
  calendar_key text NOT NULL,
  calendar_version smallint NOT NULL,
  source text NOT NULL DEFAULT 'operator',
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.instrument_calendar_bindings TO service_role;
GRANT SELECT ON public.instrument_calendar_bindings TO authenticated;
ALTER TABLE public.instrument_calendar_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calendar bindings are admin readable"
  ON public.instrument_calendar_bindings FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE TRIGGER instrument_calendar_bindings_touch
  BEFORE UPDATE ON public.instrument_calendar_bindings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.instrument_calendar_bindings (symbol, asset_class, calendar_key, calendar_version, note)
VALUES
  ('XAUUSD','metal','metal_spot',1,'frozen Wave 0 behaviour, recorded not changed'),
  ('GBPAUD','fx','fx_spot',1,'frozen Wave 0 behaviour, recorded not changed'),
  ('EURUSD','fx','fx_spot',1,'frozen Wave 0 behaviour, recorded not changed'),
  ('GBPUSD','fx','fx_spot',1,NULL),
  ('USDJPY','fx','fx_spot',1,NULL),
  ('AUDUSD','fx','fx_spot',1,NULL),
  ('USDCAD','fx','fx_spot',1,NULL),
  ('USDCHF','fx','fx_spot',1,NULL),
  ('XAGUSD','metal','metal_spot',1,NULL),
  ('USOIL','energy','energy_cfd',1,NULL),
  ('UKOIL','energy','energy_cfd',1,NULL),
  ('NAS100','index','us_index_cfd',1,NULL)
ON CONFLICT (symbol) DO NOTHING;

-- Correlation groups: portfolio exposure must treat a group as ONE risk.
CREATE TABLE IF NOT EXISTS public.instrument_correlation_groups (
  symbol text PRIMARY KEY,
  group_key text NOT NULL,
  rationale text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.instrument_correlation_groups TO service_role;
GRANT SELECT ON public.instrument_correlation_groups TO authenticated;
ALTER TABLE public.instrument_correlation_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "correlation groups are admin readable"
  ON public.instrument_correlation_groups FOR SELECT TO authenticated
  USING (public.is_admin());

INSERT INTO public.instrument_correlation_groups (symbol, group_key, rationale) VALUES
  ('XAUUSD','metals_usd','USD-quoted precious metal'),
  ('XAGUSD','metals_usd','USD-quoted precious metal, historically co-moves with gold'),
  ('USOIL','energy','crude oil benchmark'),
  ('UKOIL','energy','crude oil benchmark'),
  ('NAS100','index_risk','US equity index risk')
ON CONFLICT (symbol) DO NOTHING;

-- The four Wave 2 instruments: definitions and lifecycle rows only, disabled.
INSERT INTO public.instrument_lifecycle (symbol, stage, wave, data_health)
VALUES
  ('XAGUSD','disabled',2,'no evidence collected'),
  ('USOIL','disabled',2,'no evidence collected'),
  ('UKOIL','disabled',2,'no evidence collected'),
  ('NAS100','disabled',2,'no evidence collected')
ON CONFLICT (symbol) DO NOTHING;