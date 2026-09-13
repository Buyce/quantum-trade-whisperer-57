-- Platform-wide learning/outcome evidence for the in-app assistant.
-- [INVARIANT] Aggregate-only by construction: no user_id, no account identity,
-- no money (equity, balance, cash P&L), no lot sizes. Cohorts below the minimum
-- group size are withheld so a single account can never be singled out.
CREATE OR REPLACE FUNCTION public.get_platform_benchmarks()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH min_group AS (SELECT 5 AS n),
resolved AS (
  SELECT signal_grade, signal_instrument, outcome, r_vs_actual_risk
  FROM public.executed_trades
  WHERE outcome IN ('win','loss','breakeven')
    AND r_vs_actual_risk IS NOT NULL
),
totals AS (
  SELECT count(*)::int AS trades,
         round(100.0 * count(*) FILTER (WHERE outcome = 'win') / greatest(count(*),1), 1) AS win_rate,
         round(avg(r_vs_actual_risk)::numeric, 3) AS avg_r
  FROM resolved
),
by_grade AS (
  SELECT signal_grade AS grade, count(*)::int AS trades,
         round(100.0 * count(*) FILTER (WHERE outcome = 'win') / count(*), 1) AS win_rate,
         round(avg(r_vs_actual_risk)::numeric, 3) AS avg_r
  FROM resolved WHERE signal_grade IS NOT NULL
  GROUP BY signal_grade HAVING count(*) >= (SELECT n FROM min_group)
),
by_instrument AS (
  SELECT signal_instrument AS instrument, count(*)::int AS trades,
         round(100.0 * count(*) FILTER (WHERE outcome = 'win') / count(*), 1) AS win_rate,
         round(avg(r_vs_actual_risk)::numeric, 3) AS avg_r
  FROM resolved WHERE signal_instrument IS NOT NULL
  GROUP BY signal_instrument HAVING count(*) >= (SELECT n FROM min_group)
),
signals AS (
  SELECT count(*)::int AS published_retained,
         count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS published_last_7d,
         min(created_at) AS earliest_retained
  FROM public.scanned_signals
),
signals_by_grade AS (
  SELECT grade::text AS grade, count(*)::int AS published
  FROM public.scanned_signals GROUP BY grade
),
shadow AS (
  SELECT count(*)::int AS replays,
         count(*) FILTER (WHERE resolved_outcome IS NOT NULL)::int AS resolved,
         round(100.0 * count(*) FILTER (WHERE filled_at IS NOT NULL) / greatest(count(*),1), 1) AS fill_rate,
         round(avg(net_r) FILTER (WHERE resolved_outcome IS NOT NULL)::numeric, 3) AS avg_net_r
  FROM public.shadow_executions
),
lifecycle AS (
  SELECT jsonb_object_agg(symbol, stage) AS stages FROM public.instrument_lifecycle
)
SELECT jsonb_build_object(
  'scope', 'platform_wide_all_accounts',
  'privacy', 'Aggregate-only: contains no account identity, no equity or cash amounts and no lot sizes. Cohorts under ' || (SELECT n FROM min_group) || ' trades are withheld.',
  'r_basis', 'actual_risk',
  'broker_verified_trades', (SELECT to_jsonb(t) FROM totals t),
  'by_grade', COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM by_grade g), '[]'::jsonb),
  'by_instrument', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM by_instrument i), '[]'::jsonb),
  'published_setups', (SELECT to_jsonb(s) FROM signals s),
  'published_by_grade', COALESCE((SELECT jsonb_agg(to_jsonb(sg)) FROM signals_by_grade sg), '[]'::jsonb),
  'shadow_replay', (SELECT to_jsonb(sh) FROM shadow sh),
  'instrument_stages', COALESCE((SELECT stages FROM lifecycle), '{}'::jsonb),
  'note', 'Descriptive in-sample and broker-verified records across all connected accounts. Not a forecast and not a validated edge estimate. Empty or withheld cohorts mean insufficient samples, never a scanner claim.'
);
$$;

REVOKE ALL ON FUNCTION public.get_platform_benchmarks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_benchmarks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_benchmarks() TO service_role;

COMMENT ON FUNCTION public.get_platform_benchmarks() IS
  'Platform-wide aggregate learning/outcome evidence for signed-in users and the in-app assistant. Never returns per-account identity, money amounts or lot sizes; cohorts under the minimum group size are withheld.';