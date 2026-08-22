-- Prompt 12 completion patch.

-- 1. Broker point size: MT5 SYMBOL_POINT is 10^-digits and is NOT necessarily
--    the tick size. Persisted explicitly so the minimum stop distance is
--    stopsLevel * point, never stopsLevel * tickSize.
ALTER TABLE public.broker_symbol_specs
  ADD COLUMN IF NOT EXISTS point numeric,
  ADD COLUMN IF NOT EXISTS point_source text;

-- 2. Durable per-symbol specification attempt budget. The row is claimed BEFORE
--    the broker call, so a broker failure or a later write failure still spends
--    the 24h budget and cannot cause a request on every 15-minute cycle.
CREATE TABLE IF NOT EXISTS public.spec_refresh_attempts (
  symbol text PRIMARY KEY,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_outcome text,
  last_error text
);

GRANT ALL ON public.spec_refresh_attempts TO service_role;
ALTER TABLE public.spec_refresh_attempts ENABLE ROW LEVEL SECURITY;
-- Internal engine table: no policies, so only the service role can reach it.

CREATE OR REPLACE FUNCTION public.claim_spec_refresh(_symbol text, _min_interval_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed boolean;
BEGIN
  INSERT INTO public.spec_refresh_attempts AS s (symbol, last_attempt_at, attempts, last_outcome)
  VALUES (_symbol, now(), 1, 'claimed')
  ON CONFLICT (symbol) DO UPDATE
    SET last_attempt_at = now(),
        attempts = s.attempts + 1,
        last_outcome = 'claimed'
    WHERE s.last_attempt_at < now() - make_interval(secs => _min_interval_seconds)
  RETURNING true INTO claimed;
  RETURN COALESCE(claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_spec_refresh(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_spec_refresh(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.record_spec_refresh_outcome(_symbol text, _outcome text, _error text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.spec_refresh_attempts
     SET last_outcome = _outcome, last_error = _error
   WHERE symbol = _symbol;
$$;

REVOKE ALL ON FUNCTION public.record_spec_refresh_outcome(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_spec_refresh_outcome(text, text, text) TO service_role;

-- 3. Promotion control for broker-spec sizing (model 2). Service-role only:
--    shadow_engine_state has no policies, so it is unreachable from the client
--    and from MCP. Model 1 stays authoritative while this is false.
ALTER TABLE public.shadow_engine_state
  ADD COLUMN IF NOT EXISTS sizing_v2_enabled boolean NOT NULL DEFAULT false;