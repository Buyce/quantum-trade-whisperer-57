CREATE TABLE IF NOT EXISTS public.scanner_starvation_incidents (
  id bigserial PRIMARY KEY,
  opened_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  notified boolean NOT NULL DEFAULT false,
  stale integer NOT NULL,
  analysed integer NOT NULL,
  detail text
);

GRANT SELECT ON public.scanner_starvation_incidents TO authenticated;
GRANT ALL ON public.scanner_starvation_incidents TO service_role;

ALTER TABLE public.scanner_starvation_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read starvation incidents" ON public.scanner_starvation_incidents;
CREATE POLICY "admins read starvation incidents"
  ON public.scanner_starvation_incidents FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE UNIQUE INDEX IF NOT EXISTS scanner_starvation_one_open_idx
  ON public.scanner_starvation_incidents ((cleared_at IS NULL))
  WHERE cleared_at IS NULL;

-- Opens an incident only when none is open, so the owner is notified once per
-- outage rather than once per discarded job. Returns the row to notify, or none.
CREATE OR REPLACE FUNCTION public.claim_starvation_incident(
  _stale integer,
  _analysed integer,
  _detail text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.scanner_starvation_incidents (stale, analysed, detail)
  SELECT _stale, _analysed, _detail
   WHERE NOT EXISTS (
     SELECT 1 FROM public.scanner_starvation_incidents WHERE cleared_at IS NULL
   )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- Marks the open incident notified, so a failed send retries next cycle.
CREATE OR REPLACE FUNCTION public.mark_starvation_notified(_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.scanner_starvation_incidents SET notified = true WHERE id = _id;
$function$;

-- Closes the open incident once real analysis resumes.
CREATE OR REPLACE FUNCTION public.clear_starvation_incident()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id bigint;
BEGIN
  UPDATE public.scanner_starvation_incidents
     SET cleared_at = now()
   WHERE cleared_at IS NULL
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_starvation_incident(integer, integer, text) FROM public;
REVOKE ALL ON FUNCTION public.mark_starvation_notified(bigint) FROM public;
REVOKE ALL ON FUNCTION public.clear_starvation_incident() FROM public;