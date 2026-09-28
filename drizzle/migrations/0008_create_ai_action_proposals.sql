CREATE TABLE public.ai_action_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('cancel_order','risk_policy','cohort_policy')),
  payload jsonb NOT NULL,
  summary text NOT NULL,
  source text NOT NULL DEFAULT 'in_app' CHECK (source IN ('in_app','mcp')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','expired','failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  decided_at timestamptz
);
GRANT SELECT, INSERT ON public.ai_action_proposals TO authenticated;
GRANT ALL ON public.ai_action_proposals TO service_role;
ALTER TABLE public.ai_action_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own proposals read" ON public.ai_action_proposals FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own proposals create pending" ON public.ai_action_proposals FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending' AND decided_at IS NULL AND result IS NULL AND expires_at <= now() + interval '16 minutes');
CREATE INDEX ai_action_proposals_user_idx ON public.ai_action_proposals (user_id, created_at DESC);