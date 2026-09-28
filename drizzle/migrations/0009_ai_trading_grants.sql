ALTER TABLE public.ai_action_proposals DROP CONSTRAINT ai_action_proposals_kind_check;
ALTER TABLE public.ai_action_proposals ADD CONSTRAINT ai_action_proposals_kind_check CHECK (kind = ANY (ARRAY['cancel_order','risk_policy','cohort_policy','trading_grant']));
ALTER TABLE public.ai_action_proposals ADD COLUMN IF NOT EXISTS client_id text;

CREATE TABLE public.ai_trading_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  client_label text,
  account_ids uuid[] NOT NULL,
  actions text[] NOT NULL,
  include_live boolean NOT NULL DEFAULT false,
  max_orders integer NOT NULL DEFAULT 5 CHECK (max_orders BETWEEN 1 AND 50),
  orders_used integer NOT NULL DEFAULT 0,
  max_risk_percent numeric NOT NULL CHECK (max_risk_percent > 0 AND max_risk_percent <= 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text
);
CREATE INDEX ai_trading_grants_active_idx ON public.ai_trading_grants (user_id, client_id) WHERE revoked_at IS NULL;
GRANT SELECT ON public.ai_trading_grants TO authenticated;
GRANT ALL ON public.ai_trading_grants TO service_role;
ALTER TABLE public.ai_trading_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own grants read" ON public.ai_trading_grants FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.ai_trade_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grant_id uuid REFERENCES public.ai_trading_grants(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid,
  account_type text,
  action text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL,
  detail text,
  broker_order_id text,
  broker_position_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_trade_actions_user_idx ON public.ai_trade_actions (user_id, created_at DESC);
GRANT SELECT ON public.ai_trade_actions TO authenticated;
GRANT ALL ON public.ai_trade_actions TO service_role;
ALTER TABLE public.ai_trade_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai actions read" ON public.ai_trade_actions FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Atomically consume one order slot on an active grant.
CREATE OR REPLACE FUNCTION public.consume_ai_grant_order(_grant_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (
    UPDATE public.ai_trading_grants SET orders_used = orders_used + 1
    WHERE id = _grant_id AND revoked_at IS NULL AND expires_at > now() AND orders_used < max_orders
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM u);
$$;
REVOKE ALL ON FUNCTION public.consume_ai_grant_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_grant_order(uuid) TO service_role;