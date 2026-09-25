CREATE TABLE public.reconciliation_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connected_account_id uuid NOT NULL REFERENCES public.connected_trading_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('order_missing_at_broker','broker_fill_unmatched','position_untracked','balance_drift')),
  ref text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning','critical')),
  summary text NOT NULL,
  platform_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  broker_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  UNIQUE (connected_account_id, kind, ref)
);
COMMENT ON TABLE public.reconciliation_discrepancies IS 'Flag-only mismatches between broker-reported orders/positions/fills/balance and platform records, written by the reconcile worker. Never auto-corrected.';

GRANT SELECT, UPDATE ON public.reconciliation_discrepancies TO authenticated;
GRANT ALL ON public.reconciliation_discrepancies TO service_role;

ALTER TABLE public.reconciliation_discrepancies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their discrepancies" ON public.reconciliation_discrepancies
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Owners acknowledge their discrepancies" ON public.reconciliation_discrepancies
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX reconciliation_discrepancies_open_idx ON public.reconciliation_discrepancies (user_id, status) WHERE status <> 'resolved';