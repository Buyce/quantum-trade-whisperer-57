-- ============================================================
-- Market context: intermarket series, positioning, and the ledger
-- ============================================================

CREATE TABLE public.market_context_series (
  id BIGSERIAL PRIMARY KEY,
  series_key TEXT NOT NULL,
  observation_date DATE NOT NULL,
  value NUMERIC NOT NULL,
  source TEXT NOT NULL,
  source_series_id TEXT,
  units TEXT,
  note TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (series_key, observation_date)
);

GRANT ALL ON public.market_context_series TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.market_context_series_id_seq TO service_role;
ALTER TABLE public.market_context_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_context_series service only" ON public.market_context_series
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX market_context_series_lookup
  ON public.market_context_series (series_key, observation_date DESC);

CREATE TABLE public.positioning_snapshots (
  id BIGSERIAL PRIMARY KEY,
  currency TEXT NOT NULL,
  report_date DATE NOT NULL,
  long_contracts NUMERIC,
  short_contracts NUMERIC,
  net_contracts NUMERIC,
  net_percent NUMERIC,
  source TEXT NOT NULL,
  source_market_code TEXT,
  note TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (currency, report_date, source)
);

GRANT ALL ON public.positioning_snapshots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.positioning_snapshots_id_seq TO service_role;
ALTER TABLE public.positioning_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "positioning_snapshots service only" ON public.positioning_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX positioning_snapshots_lookup
  ON public.positioning_snapshots (currency, report_date DESC);

-- Every attempt, including failures. An absent value must never look like a
-- neutral reading, so the failure is recorded here and no value is stored.
CREATE TABLE public.market_context_runs (
  id BIGSERIAL PRIMARY KEY,
  job TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('ok','empty','partial','outage','authorization_error','invalid_response','throttled')),
  series_requested INTEGER NOT NULL DEFAULT 0,
  values_written INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  error_class TEXT,
  error_note TEXT,
  worker_version TEXT NOT NULL DEFAULT 'market-context-1'
);

GRANT ALL ON public.market_context_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.market_context_runs_id_seq TO service_role;
ALTER TABLE public.market_context_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_context_runs service only" ON public.market_context_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX market_context_runs_recent ON public.market_context_runs (started_at DESC);

-- ============================================================
-- Context stamped on captured setups (nullable: absent means unknown)
-- ============================================================

ALTER TABLE public.scanned_signals
  ADD COLUMN IF NOT EXISTS ctx_dollar_direction TEXT
    CHECK (ctx_dollar_direction IN ('up','down','flat')),
  ADD COLUMN IF NOT EXISTS ctx_yield_direction TEXT
    CHECK (ctx_yield_direction IN ('up','down','flat')),
  ADD COLUMN IF NOT EXISTS ctx_alignment TEXT
    CHECK (ctx_alignment IN ('aligned','against','neutral')),
  ADD COLUMN IF NOT EXISTS ctx_vol_regime TEXT
    CHECK (ctx_vol_regime IN ('calm','normal','stressed')),
  ADD COLUMN IF NOT EXISTS ctx_positioning_bias TEXT
    CHECK (ctx_positioning_bias IN ('long','short','flat')),
  ADD COLUMN IF NOT EXISTS ctx_positioning_report_date DATE,
  ADD COLUMN IF NOT EXISTS ctx_observed_at TIMESTAMPTZ;

ALTER TABLE public.research_candidates
  ADD COLUMN IF NOT EXISTS ctx_dollar_direction TEXT
    CHECK (ctx_dollar_direction IN ('up','down','flat')),
  ADD COLUMN IF NOT EXISTS ctx_yield_direction TEXT
    CHECK (ctx_yield_direction IN ('up','down','flat')),
  ADD COLUMN IF NOT EXISTS ctx_alignment TEXT
    CHECK (ctx_alignment IN ('aligned','against','neutral')),
  ADD COLUMN IF NOT EXISTS ctx_vol_regime TEXT
    CHECK (ctx_vol_regime IN ('calm','normal','stressed')),
  ADD COLUMN IF NOT EXISTS ctx_positioning_bias TEXT
    CHECK (ctx_positioning_bias IN ('long','short','flat')),
  ADD COLUMN IF NOT EXISTS ctx_positioning_report_date DATE,
  ADD COLUMN IF NOT EXISTS ctx_observed_at TIMESTAMPTZ;

-- ============================================================
-- Owner-only reader
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_market_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'latest', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT DISTINCT ON (series_key)
          series_key, observation_date, value, source, units, fetched_at
        FROM public.market_context_series
        ORDER BY series_key, observation_date DESC
      ) t
    ), '[]'::jsonb),
    'positioning', COALESCE((
      SELECT jsonb_agg(row_to_json(p))
      FROM (
        SELECT DISTINCT ON (currency)
          currency, report_date, net_contracts, net_percent, source, fetched_at
        FROM public.positioning_snapshots
        ORDER BY currency, report_date DESC
      ) p
    ), '[]'::jsonb),
    'runs', COALESCE((
      SELECT jsonb_agg(row_to_json(r))
      FROM (
        SELECT job, source, started_at, completed_at, status,
               series_requested, values_written, response_status, error_class, error_note
        FROM public.market_context_runs
        ORDER BY started_at DESC
        LIMIT 20
      ) r
    ), '[]'::jsonb),
    'alignment', COALESCE((
      SELECT jsonb_agg(row_to_json(a))
      FROM (
        SELECT s.instrument,
               s.ctx_alignment AS alignment,
               COUNT(*)::int AS n,
               ROUND(AVG(se.realized_r)::numeric, 4) AS mean_r,
               ROUND((AVG(CASE WHEN se.realized_r > 0 THEN 1 ELSE 0 END) * 100)::numeric, 1) AS win_pct
        FROM public.scanned_signals s
        JOIN public.shadow_executions se ON se.signal_id = s.id
        WHERE s.ctx_alignment IS NOT NULL
          AND se.realized_r IS NOT NULL
        GROUP BY s.instrument, s.ctx_alignment
        ORDER BY s.instrument, s.ctx_alignment
      ) a
    ), '[]'::jsonb),
    'generated_at', now()
  );
$$;

REVOKE ALL ON FUNCTION public.get_admin_market_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_market_context() TO service_role;