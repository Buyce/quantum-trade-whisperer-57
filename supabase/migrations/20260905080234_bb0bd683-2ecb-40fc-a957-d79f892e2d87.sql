CREATE TABLE public.execution_quality_scores (
  account_id UUID NOT NULL REFERENCES public.connected_trading_accounts(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  session TEXT NOT NULL,
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  recent_window_days INTEGER NOT NULL,
  closed_sample INTEGER NOT NULL,
  slippage_sample INTEGER NOT NULL,
  median_slippage NUMERIC,
  p90_slippage NUMERIC,
  r_sample INTEGER NOT NULL,
  avg_r NUMERIC,
  delivery_sample INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  reject_rate NUMERIC,
  margin_refusals INTEGER NOT NULL DEFAULT 0,
  median_order_to_fill_seconds NUMERIC,
  norm_closed_sample INTEGER NOT NULL DEFAULT 0,
  norm_median_slippage NUMERIC,
  norm_reject_rate NUMERIC,
  measured BOOLEAN NOT NULL,
  unmeasured_reason TEXT,
  PRIMARY KEY (account_id, instrument, session)
);
GRANT SELECT ON public.execution_quality_scores TO authenticated;
GRANT ALL ON public.execution_quality_scores TO service_role;
ALTER TABLE public.execution_quality_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their own execution quality scores" ON public.execution_quality_scores FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.connected_trading_accounts c WHERE c.id = account_id AND c.user_id = auth.uid()));

CREATE TABLE public.execution_cooldowns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.connected_trading_accounts(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  session TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL,
  observed_value NUMERIC,
  norm_value NUMERIC,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resume_after TIMESTAMP WITH TIME ZONE NOT NULL,
  lifted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT ON public.execution_cooldowns TO authenticated;
GRANT ALL ON public.execution_cooldowns TO service_role;
ALTER TABLE public.execution_cooldowns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their own execution cooldowns" ON public.execution_cooldowns FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.connected_trading_accounts c WHERE c.id = account_id AND c.user_id = auth.uid()));
CREATE INDEX execution_cooldowns_active_idx ON public.execution_cooldowns (account_id, instrument, session) WHERE lifted_at IS NULL;
CREATE TRIGGER update_execution_cooldowns_updated_at BEFORE UPDATE ON public.execution_cooldowns FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();