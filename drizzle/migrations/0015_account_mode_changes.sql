CREATE TABLE public.account_mode_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  old_mode text,
  new_mode text NOT NULL,
  cause text NOT NULL,
  reason text,
  actor_role text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.account_mode_changes TO authenticated;
GRANT ALL ON public.account_mode_changes TO service_role;
ALTER TABLE public.account_mode_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners and admins read mode changes" ON public.account_mode_changes
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
CREATE INDEX account_mode_changes_account_idx ON public.account_mode_changes (account_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.forbid_mode_change_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'account_mode_changes is append-only'; END $$;
CREATE TRIGGER account_mode_changes_append_only BEFORE UPDATE OR DELETE ON public.account_mode_changes
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mode_change_edit();

CREATE OR REPLACE FUNCTION public.record_account_mode_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role text := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', current_user);
BEGIN
  IF NEW.mode IS DISTINCT FROM OLD.mode THEN
    INSERT INTO public.account_mode_changes (account_id, user_id, old_mode, new_mode, cause, reason, actor_role)
    VALUES (NEW.id, NEW.user_id, OLD.mode, NEW.mode,
      CASE
        WHEN NEW.disconnected_at IS DISTINCT FROM OLD.disconnected_at AND NEW.disconnected_at IS NOT NULL THEN 'disconnect'
        WHEN NEW.emergency_stop_at IS DISTINCT FROM OLD.emergency_stop_at AND NEW.emergency_stop_at IS NOT NULL THEN 'emergency_stop'
        WHEN NEW.stand_down_reason IS NOT NULL AND NEW.stand_down_reason IS DISTINCT FROM OLD.stand_down_reason THEN 'broker_stand_down'
        WHEN NEW.live_auto_default_applied_at IS DISTINCT FROM OLD.live_auto_default_applied_at THEN 'live_auto_default'
        ELSE 'mode_set'
      END,
      coalesce(NEW.stand_down_reason, NEW.emergency_stop_reason), _role);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER connected_accounts_record_mode_change AFTER UPDATE OF mode ON public.connected_trading_accounts
  FOR EACH ROW EXECUTE FUNCTION public.record_account_mode_change();