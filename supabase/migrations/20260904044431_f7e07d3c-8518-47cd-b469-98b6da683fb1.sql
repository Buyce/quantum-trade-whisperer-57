CREATE OR REPLACE FUNCTION public.gate_default_value(_gate text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _gate
           WHEN 'risk_ceiling' THEN 3::numeric
           WHEN 'headroom' THEN 2.5::numeric
           WHEN 'reachable_r' THEN 1::numeric
         END;
$$;