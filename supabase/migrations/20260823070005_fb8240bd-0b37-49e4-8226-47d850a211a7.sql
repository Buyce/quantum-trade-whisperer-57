CREATE TABLE public.broker_trade_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evidence_class text NOT NULL
    CHECK (evidence_class IN ('benchmark','customer','self_reported')),
  account_id uuid REFERENCES public.connected_trading_accounts(id) ON DELETE SET NULL,
  metaapi_account_id text,
  signal_id uuid REFERENCES public.scanned_signals(id) ON DELETE SET NULL,
  delivery_id bigint REFERENCES public.execution_deliveries(id) ON DELETE SET NULL,
  client_id text,
  magic integer,
  association_basis text NOT NULL
    CHECK (association_basis IN ('client_id','client_id_and_magic','position_id','self_reported')),
  broker_order_id text,
  broker_position_id text,
  broker_symbol text NOT NULL,
  direction text CHECK (direction IN ('long','short')),
  planned_entry numeric,
  planned_stop numeric,
  planned_target numeric,
  actual_initial_stop numeric,
  volume numeric,
  entry_price numeric,
  exit_price numeric,
  entry_at timestamptz,
  exit_at timestamptz,
  commission numeric,
  swap numeric,
  gross_profit numeric,
  profit_currency text,
  r_vs_plan numeric,
  r_vs_actual_risk numeric,
  r_availability text,
  stop_provenance text,
  r_math_version smallint,
  deals jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX broker_trade_evidence_identity
  ON public.broker_trade_evidence (evidence_class, COALESCE(metaapi_account_id, ''), COALESCE(client_id, ''), COALESCE(broker_position_id, ''));

CREATE INDEX broker_trade_evidence_user ON public.broker_trade_evidence (user_id, first_observed_at DESC);
CREATE INDEX broker_trade_evidence_signal ON public.broker_trade_evidence (signal_id);

GRANT SELECT ON public.broker_trade_evidence TO authenticated;
GRANT ALL ON public.broker_trade_evidence TO service_role;

ALTER TABLE public.broker_trade_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their own broker evidence"
  ON public.broker_trade_evidence FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.enforce_evidence_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'broker_trade_evidence rows are immutable evidence and cannot be deleted';
  END IF;
  IF OLD.state = 'closed' THEN
    RAISE EXCEPTION 'closed broker evidence is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER broker_trade_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.broker_trade_evidence
  FOR EACH ROW EXECUTE FUNCTION public.enforce_evidence_immutability();