-- ============================================================
-- Prompt 14 / Stage 2 — Connected broker accounts
-- ============================================================
-- No MetaTrader password is ever stored here. Credentials are entered by the
-- account owner on MetaApi's own hosted configuration page; P-Trades keeps only
-- the returned MetaApi account id. Configuration URLs are never persisted.
-- All financial classification columns are BROKER-DERIVED (Client API account
-- information); `intent` is onboarding intent only and is never authoritative.

CREATE OR REPLACE FUNCTION public.touch_connected_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.connected_trading_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,

  -- MetaApi identity. NULL only for the brief window between our row insert and
  -- a successful (idempotent) MetaApi create.
  metaapi_account_id text,
  provision_transaction_id text NOT NULL,

  label text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('mt4','mt5')),
  broker_server text,
  region text NOT NULL CHECK (region ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  magic integer,

  -- Onboarding intent ONLY. Never used to decide anything financial.
  intent text NOT NULL CHECK (intent IN ('demo','live')),

  -- Real lifecycle.
  phase text NOT NULL DEFAULT 'awaiting_credentials'
    CHECK (phase IN ('created','awaiting_credentials','deploying','deployed_not_connected',
                     'connected','broker_rejected','undeployed','failed','ready')),
  credentials_configured boolean NOT NULL DEFAULT false,
  provisioning_state text,
  connection_status text,

  -- Broker-derived truth.
  broker_account_type text NOT NULL DEFAULT 'unknown'
    CHECK (broker_account_type IN ('demo','real','contest','unknown')),
  broker_name text,
  broker_login_masked text,
  account_currency text,
  trade_allowed boolean,
  investor_mode boolean,
  margin_mode text,
  leverage numeric,
  broker_balance numeric,
  broker_equity numeric,
  broker_free_margin numeric,
  broker_margin_level numeric,
  broker_observed_at timestamptz,

  -- Execution mode. Stage 2 can only ever be 'observe'.
  mode text NOT NULL DEFAULT 'observe'
    CHECK (mode IN ('observe','demo_auto','live_confirm','live_auto')),

  -- TRUE when the broker reports an account type that contradicts `intent`.
  -- Hard stop: the wizard refuses to finish and warns the owner.
  intent_conflict boolean NOT NULL DEFAULT false,
  intent_conflict_reason text,

  last_error text,
  last_reconciled_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.connected_trading_accounts IS
  'Customer broker connections. Distinct from the P-Trades benchmark account, which lives in server configuration and never appears here. No MetaTrader password and no MetaApi configuration URL is stored.';
COMMENT ON COLUMN public.connected_trading_accounts.intent IS
  'Onboarding intent only. MetaApi account information (broker_account_type) is authoritative.';
COMMENT ON COLUMN public.connected_trading_accounts.broker_equity IS
  'Broker-reported equity for display and provenance. Never written back over a user-entered risk equity.';

CREATE UNIQUE INDEX connected_trading_accounts_metaapi_id_key
  ON public.connected_trading_accounts (metaapi_account_id)
  WHERE metaapi_account_id IS NOT NULL;
CREATE UNIQUE INDEX connected_trading_accounts_txn_key
  ON public.connected_trading_accounts (provision_transaction_id);
CREATE INDEX connected_trading_accounts_user_idx
  ON public.connected_trading_accounts (user_id, disconnected_at);

GRANT SELECT ON public.connected_trading_accounts TO authenticated;
GRANT ALL ON public.connected_trading_accounts TO service_role;
ALTER TABLE public.connected_trading_accounts ENABLE ROW LEVEL SECURITY;

-- Owners read their own connections. Every write (provisioning, reconciliation,
-- disconnect) goes through a server function running as service_role, so a
-- client can never fabricate a broker classification or a phase.
CREATE POLICY "Owners read their own connected accounts"
  ON public.connected_trading_accounts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER connected_trading_accounts_updated_at
  BEFORE UPDATE ON public.connected_trading_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_connected_account();

-- ---------------- account quota (configurable) ----------------

CREATE TABLE public.account_quota_defaults (
  id boolean NOT NULL PRIMARY KEY DEFAULT true CHECK (id),
  max_demo integer NOT NULL DEFAULT 1 CHECK (max_demo >= 0),
  max_live integer NOT NULL DEFAULT 1 CHECK (max_live >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.account_quota_defaults (id) VALUES (true);
GRANT SELECT ON public.account_quota_defaults TO authenticated;
GRANT ALL ON public.account_quota_defaults TO service_role;
ALTER TABLE public.account_quota_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in may read the default quota"
  ON public.account_quota_defaults FOR SELECT TO authenticated USING (true);

CREATE TABLE public.account_quota_overrides (
  user_id uuid NOT NULL PRIMARY KEY,
  max_demo integer CHECK (max_demo >= 0),
  max_live integer CHECK (max_live >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.account_quota_overrides TO authenticated;
GRANT ALL ON public.account_quota_overrides TO service_role;
ALTER TABLE public.account_quota_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their own quota override"
  ON public.account_quota_overrides FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.account_quota(_user_id uuid)
RETURNS TABLE (max_demo integer, max_live integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(o.max_demo, d.max_demo), coalesce(o.max_live, d.max_live)
    FROM account_quota_defaults d
    LEFT JOIN account_quota_overrides o ON o.user_id = _user_id
   WHERE d.id;
$$;
GRANT EXECUTE ON FUNCTION public.account_quota(uuid) TO authenticated, service_role;

-- Enforced in SQL so no code path (including a future one) can exceed it.
CREATE OR REPLACE FUNCTION public.enforce_account_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_max integer;
  v_used integer;
BEGIN
  SELECT CASE WHEN NEW.intent = 'demo' THEN q.max_demo ELSE q.max_live END
    INTO v_max FROM public.account_quota(NEW.user_id) q;

  SELECT count(*) INTO v_used
    FROM connected_trading_accounts
   WHERE user_id = NEW.user_id
     AND intent = NEW.intent
     AND disconnected_at IS NULL
     AND id <> NEW.id;

  IF v_used >= coalesce(v_max, 0) THEN
    RAISE EXCEPTION 'account_quota_exceeded: % connection limit reached (% of %)',
      NEW.intent, v_used, coalesce(v_max, 0);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER connected_trading_accounts_quota
  BEFORE INSERT ON public.connected_trading_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_quota();

-- ---------------- per-connection symbol map ----------------

CREATE TABLE public.connected_account_symbols (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.connected_trading_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  canonical_symbol text NOT NULL,
  broker_symbol text,
  mapping_kind text NOT NULL
    CHECK (mapping_kind IN ('exact','suffix','ambiguous','unavailable')),
  candidates text[] NOT NULL DEFAULT '{}',
  resolved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, canonical_symbol)
);
COMMENT ON TABLE public.connected_account_symbols IS
  'Canonical instrument -> this broker''s own symbol name. `ambiguous` and `unavailable` are refusals, not fallbacks: nothing downstream may guess a symbol.';
GRANT SELECT ON public.connected_account_symbols TO authenticated;
GRANT ALL ON public.connected_account_symbols TO service_role;
ALTER TABLE public.connected_account_symbols ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their own symbol map"
  ON public.connected_account_symbols FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ---------------- account-scoped symbol specifications ----------------
-- Deliberately a separate table from broker_symbol_specs (which is the
-- benchmark/reference feed). A benchmark spec must never be presented as a
-- customer broker's spec.

CREATE TABLE public.connected_account_specs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.connected_trading_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  broker_symbol text NOT NULL,
  canonical_symbol text,
  contract_size numeric,
  tick_size numeric,
  tick_value numeric,
  point numeric,
  point_source text,
  digits integer,
  volume_min numeric,
  volume_max numeric,
  volume_step numeric,
  volume_limit numeric,
  stops_level numeric,
  freeze_level numeric,
  base_currency text,
  profit_currency text,
  margin_currency text,
  trade_mode text,
  calc_mode text,
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, broker_symbol)
);
COMMENT ON TABLE public.connected_account_specs IS
  'Symbol specifications read from the customer''s OWN broker account. Never seeded from the benchmark account.';
GRANT SELECT ON public.connected_account_specs TO authenticated;
GRANT ALL ON public.connected_account_specs TO service_role;
ALTER TABLE public.connected_account_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their own account specs"
  ON public.connected_account_specs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ---------------- account feature state ----------------

CREATE TABLE public.connected_account_features (
  account_id uuid NOT NULL PRIMARY KEY
    REFERENCES public.connected_trading_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  metastats_api_enabled boolean NOT NULL DEFAULT false,
  risk_management_api_enabled boolean NOT NULL DEFAULT false,
  mt5_netting boolean NOT NULL DEFAULT false,
  risk_guardian_available boolean NOT NULL DEFAULT false,
  risk_guardian_reason text,
  reliability text,
  observed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.connected_account_features.mt5_netting IS
  'MetaApi''s Risk Management API does not support MT5 netting accounts (vendor limitation). When true, Risk Guardian is reported unavailable rather than implied.';
GRANT SELECT ON public.connected_account_features TO authenticated;
GRANT ALL ON public.connected_account_features TO service_role;
ALTER TABLE public.connected_account_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their own account features"
  ON public.connected_account_features FOR SELECT TO authenticated
  USING (auth.uid() = user_id);