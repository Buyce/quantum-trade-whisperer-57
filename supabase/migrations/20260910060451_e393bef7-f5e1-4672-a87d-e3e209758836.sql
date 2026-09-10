CREATE OR REPLACE FUNCTION public.get_promotion_sample_evidence(_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'instrument', instrument,
        'trading_days', trading_days,
        'valid_samples', valid_samples,
        'invalid_samples', invalid_samples,
        'covered_sessions', covered_sessions,
        'observed_provider_symbols', observed_provider_symbols,
        'missingness_pct', missingness_pct
      )
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      s.instrument,
      count(DISTINCT (s.received_at AT TIME ZONE 'UTC')::date)
        FILTER (WHERE s.quality = 'valid') AS trading_days,
      count(*) FILTER (WHERE s.quality = 'valid') AS valid_samples,
      count(*) FILTER (WHERE s.quality IS DISTINCT FROM 'valid') AS invalid_samples,
      coalesce(
        (SELECT jsonb_agg(DISTINCT v.session)
         FROM instrument_spread_samples v
         WHERE v.instrument = s.instrument
           AND v.received_at >= _since
           AND v.quality = 'valid'
           AND v.session IS NOT NULL),
        '[]'::jsonb
      ) AS covered_sessions,
      coalesce(
        (SELECT jsonb_agg(DISTINCT p.provider_symbol)
         FROM instrument_spread_samples p
         WHERE p.instrument = s.instrument
           AND p.received_at >= _since
           AND p.provider_symbol IS NOT NULL),
        '[]'::jsonb
      ) AS observed_provider_symbols,
      CASE
        WHEN count(*) = 0 THEN NULL
        ELSE round(
          (count(*) FILTER (WHERE s.quality IS DISTINCT FROM 'valid'))::numeric
            * 100 / count(*)::numeric,
          4
        )
      END AS missingness_pct
    FROM instrument_spread_samples s
    WHERE s.received_at >= _since
    GROUP BY s.instrument
  ) agg;
$$;

REVOKE ALL ON FUNCTION public.get_promotion_sample_evidence(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_promotion_sample_evidence(timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.get_promotion_sample_evidence(timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_promotion_sample_evidence(timestamptz) TO service_role;