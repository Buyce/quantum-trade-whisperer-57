CREATE TABLE public.broker_evidence_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.broker_trade_evidence(id),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('chronology','profit_currency')),
  status text NOT NULL,
  raw_value text,
  annotated_value text,
  rule text NOT NULL,
  source text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.broker_evidence_annotations (evidence_id, kind, created_at DESC);
GRANT SELECT ON public.broker_evidence_annotations TO authenticated;
GRANT ALL ON public.broker_evidence_annotations TO service_role;
ALTER TABLE public.broker_evidence_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners and admins read annotations" ON public.broker_evidence_annotations
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.forbid_annotation_change() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'broker evidence annotations are append-only'; END $$;
CREATE TRIGGER broker_evidence_annotations_append_only BEFORE UPDATE OR DELETE ON public.broker_evidence_annotations
  FOR EACH ROW EXECUTE FUNCTION public.forbid_annotation_change();

INSERT INTO public.broker_evidence_annotations (evidence_id, user_id, kind, status, raw_value, annotated_value, rule, source, detail)
SELECT e.id, e.user_id, 'chronology', 'suspect', e.entry_at::text, NULL,
  'entry_before_submission_v1', 'execution_deliveries.submitted_at vs MetaApi deal time',
  jsonb_build_object('submitted_at', d.submitted_at, 'entry_at', e.entry_at, 'gap_seconds', extract(epoch from d.submitted_at - e.entry_at),
    'note', 'Excluded from chronological learning; money unchanged; raw deals retained on the evidence row')
FROM public.broker_trade_evidence e JOIN public.execution_deliveries d ON d.id = e.delivery_id
WHERE e.entry_at < d.submitted_at - interval '5 seconds';

INSERT INTO public.broker_evidence_annotations (evidence_id, user_id, kind, status, raw_value, annotated_value, rule, source)
SELECT e.id, e.user_id, 'profit_currency', 'from_account', NULL, a.account_currency,
  'account_deposit_currency_v1', 'connected_trading_accounts.account_currency (MetaApi account-information)'
FROM public.broker_trade_evidence e
JOIN public.execution_deliveries d ON d.id = e.delivery_id
JOIN public.connected_trading_accounts a ON a.id = d.connected_account_id
WHERE e.profit_currency IS NULL AND a.account_currency IS NOT NULL;