-- Human vs AI-agent provenance for accounts and trade decisions.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_source text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS signup_client text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_signup_source_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_signup_source_check CHECK (signup_source IN ('human', 'agent'));

ALTER TABLE public.executed_trades
  ADD COLUMN IF NOT EXISTS decision_source text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS decision_source_client text;

ALTER TABLE public.executed_trades
  DROP CONSTRAINT IF EXISTS executed_trades_decision_source_check;
ALTER TABLE public.executed_trades
  ADD CONSTRAINT executed_trades_decision_source_check CHECK (decision_source IN ('human', 'agent'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  insert into public.profiles (id, display_name, signup_source, signup_client)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when lower(coalesce(new.raw_user_meta_data->>'signup_source', 'human')) = 'agent'
         then 'agent' else 'human' end,
    nullif(new.raw_user_meta_data->>'signup_client', '')
  )
  on conflict (id) do nothing;
  insert into public.scanner_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Owner-only aggregate: splits accounts, decisions and user-reported outcomes
-- by who authored them (a person in the terminal vs an AI assistant over MCP).
CREATE OR REPLACE FUNCTION public.get_admin_author_split()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '3000ms'
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH active_users AS (
    SELECT user_id FROM executed_trades
    UNION
    SELECT user_id FROM signal_user_telemetry
  ),
  accounts AS (
    SELECT coalesce(p.signup_source, 'human') AS source, p.signup_client
      FROM active_users a
      LEFT JOIN profiles p ON p.id = a.user_id
  ),
  decided AS (
    SELECT coalesce(t.decision_source, 'human') AS source,
           t.decision_source_client AS client,
           t.user_decision::text AS decision
      FROM executed_trades t
  ),
  reported AS (
    SELECT coalesce(t.decision_source, 'human') AS source,
           count(*) AS n,
           count(*) FILTER (WHERE t.outcome = 'win') AS wins,
           CASE WHEN count(*) = 0 THEN NULL
                ELSE round(count(*) FILTER (WHERE t.outcome = 'win')::numeric / count(*), 4)
           END AS win_rate,
           round(avg(t.realized_r_multiple)::numeric, 3) AS mean_r
      FROM executed_trades t
     WHERE t.user_decision = 'taken'
       AND t.outcome IN ('win', 'loss', 'breakeven')
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'accounts', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.source) FROM (
        SELECT source, count(*) AS n,
               coalesce(jsonb_agg(DISTINCT signup_client) FILTER (WHERE signup_client IS NOT NULL),
                        '[]'::jsonb) AS clients
          FROM accounts GROUP BY source) x), '[]'::jsonb),
    'decisions', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.source) FROM (
        SELECT source,
               count(*) FILTER (WHERE decision = 'taken') AS taken,
               count(*) FILTER (WHERE decision = 'skipped') AS skipped,
               coalesce(jsonb_agg(DISTINCT client) FILTER (WHERE client IS NOT NULL),
                        '[]'::jsonb) AS clients
          FROM decided GROUP BY source) d), '[]'::jsonb),
    'user_reported', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.source) FROM reported r),
                              '[]'::jsonb)
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_author_split() FROM public;
GRANT EXECUTE ON FUNCTION public.get_admin_author_split() TO authenticated;