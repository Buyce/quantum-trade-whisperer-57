CREATE TABLE IF NOT EXISTS public.verify_reminder_log (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  iso_week text NOT NULL,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  missing_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, iso_week)
);

GRANT ALL ON public.verify_reminder_log TO service_role;
ALTER TABLE public.verify_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_verify_reminder(_user_id uuid, _week text, _missing integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO public.verify_reminder_log (user_id, iso_week, missing_count)
  VALUES (_user_id, _week, _missing)
  ON CONFLICT (user_id, iso_week) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_verify_reminder(_user_id uuid, _week text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.verify_reminder_log WHERE user_id = _user_id AND iso_week = _week;
$$;

REVOKE ALL ON FUNCTION public.claim_verify_reminder(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_verify_reminder(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_verify_reminder(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_verify_reminder(uuid, text) TO service_role;