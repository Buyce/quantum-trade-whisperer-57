CREATE TABLE public.auto_cohort_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long','short')),
  policy TEXT NOT NULL DEFAULT 'allow' CHECK (policy IN ('allow','reduce','block')),
  risk_share_percent INTEGER NOT NULL DEFAULT 100 CHECK (risk_share_percent BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, instrument, direction)
);

COMMENT ON TABLE public.auto_cohort_policies IS 'Per-user automatic-order rule for one instrument + direction cohort. Reduce-only: it may refuse an automatic order (policy=block) or shrink its risk (policy=reduce, risk_share_percent), and can never create or enlarge one. It never affects publication, the feed, alerts, grading, replay or any statistic.';
COMMENT ON COLUMN public.auto_cohort_policies.risk_share_percent IS 'Share of the owner''s normal per-trade risk to use when policy = reduce (1-100). Ignored for allow and block.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_cohort_policies TO authenticated;
GRANT ALL ON public.auto_cohort_policies TO service_role;

ALTER TABLE public.auto_cohort_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own cohort policies"
  ON public.auto_cohort_policies FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own cohort policies"
  ON public.auto_cohort_policies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own cohort policies"
  ON public.auto_cohort_policies FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own cohort policies"
  ON public.auto_cohort_policies FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX auto_cohort_policies_user_idx ON public.auto_cohort_policies (user_id);

CREATE TRIGGER auto_cohort_policies_touch
  BEFORE UPDATE ON public.auto_cohort_policies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();