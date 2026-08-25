ALTER VIEW public.instrument_stages SET (security_invoker = true);

GRANT SELECT (symbol, stage) ON public.instrument_lifecycle TO authenticated;

CREATE POLICY "signed-in users read instrument stages"
  ON public.instrument_lifecycle FOR SELECT TO authenticated USING (true);