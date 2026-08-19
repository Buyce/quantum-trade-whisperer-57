CREATE TABLE IF NOT EXISTS public.weekly_report_log (
  iso_week text PRIMARY KEY,
  sent_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.weekly_report_log TO service_role;
ALTER TABLE public.weekly_report_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_weekly_report(_week text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO public.weekly_report_log (iso_week)
  VALUES (_week)
  ON CONFLICT (iso_week) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_weekly_report(_week text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.weekly_report_log WHERE iso_week = _week;
$$;

REVOKE ALL ON FUNCTION public.claim_weekly_report(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_weekly_report(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_weekly_report(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_weekly_report(text) TO service_role;