-- Stage 1: frozen volatility bucket definitions.
CREATE TABLE IF NOT EXISTS public.vol_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version smallint NOT NULL,
  instrument text NOT NULL,
  definition_version smallint NOT NULL DEFAULT 1,
  t1 numeric NOT NULL,
  t2 numeric NOT NULL,
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'seeded_from_live_regime_stats',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vol_definitions_bounds CHECK (t2 >= t1)
);

CREATE UNIQUE INDEX IF NOT EXISTS vol_definitions_identity
  ON public.vol_definitions (model_version, instrument, definition_version);
CREATE UNIQUE INDEX IF NOT EXISTS vol_definitions_one_active
  ON public.vol_definitions (model_version, instrument) WHERE active;

GRANT ALL ON public.vol_definitions TO service_role;
ALTER TABLE public.vol_definitions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.regime_stats     ADD COLUMN IF NOT EXISTS vol_definition_version smallint;
ALTER TABLE public.regime_snapshots ADD COLUMN IF NOT EXISTS vol_definition_version smallint;

-- Seed the frozen definition from the boundaries currently in force, so the
-- first rebuild after this migration reproduces today's numbers exactly.
INSERT INTO public.vol_definitions (model_version, instrument, definition_version, t1, t2)
SELECT rs.model_version, rs.instrument, 1, rs.vol_t1, rs.vol_t2
  FROM public.regime_stats rs
 WHERE rs.tier = 0 AND rs.instrument IS NOT NULL
   AND rs.vol_t1 IS NOT NULL AND rs.vol_t2 IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.recompute_regime_stats(_model_version smallint DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k constant numeric := 30;
  mv smallint := coalesce(_model_version, 1);
  as_of timestamptz;
  g_n integer; g_fills integer; g_wins integer;
  g_pfill numeric; g_pwin numeric;
  out_rows integer;
  this_run uuid := gen_random_uuid();
  logged integer := 0;
  logged_tier0 integer := 0;
  legacy_null_resolved_at integer := 0;
  def_version smallint;
  defs_created integer := 0;
BEGIN
  -- 6E.5 Hard model lock: live regime_stats is production model V1 only.
  IF mv <> 1 THEN
    RETURN jsonb_build_object(
      'skipped', 'model_version_not_promoted',
      'model_version', mv,
      'production_model_version', 1
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('recompute_regime_stats'), mv);
  as_of := clock_timestamp();

  -- 6E.4 point-in-time, contamination-filtered production source.
  CREATE TEMP TABLE _regime_src ON COMMIT DROP AS
    SELECT instrument,
           direction::text AS direction,
           coalesce(trading_session, 'unknown') AS session,
           volatility_index::numeric AS volatility_index,
           CASE WHEN resolved_outcome = 'never_filled' THEN 0 ELSE 1 END AS filled,
           coalesce(ml_target_label, 0) AS win,
           (resolved_at IS NULL) AS legacy_resolved_at_null
      FROM shadow_executions
     WHERE status = 'resolved'
       AND model_version = mv
       AND replay_version = 1
       AND execution_policy = 'legacy_best_target_touched'
       AND cohort = 'production'
       AND detected_at <= as_of
       AND coalesce(resolved_at, last_polled_at, detected_at) <= as_of;

  SELECT count(*) FILTER (WHERE legacy_resolved_at_null)
    INTO legacy_null_resolved_at FROM _regime_src;

  CREATE TEMP TABLE _base ON COMMIT DROP AS
    SELECT instrument, direction, session, volatility_index, filled, win FROM _regime_src;

  -- Stage 1 (Prompt 7): volatility bucket boundaries are FROZEN, not recomputed.
  -- Recomputing them every run silently reclassified historical rows, so
  -- n_total inside one tier-3 bucket mixed samples from different definitions.
  -- A definition is created automatically only for an instrument that has never
  -- had one; existing definitions are never rewritten here.
  INSERT INTO public.vol_definitions (model_version, instrument, definition_version, t1, t2, source)
  SELECT mv, b.instrument, 1,
         percentile_cont(0.3333) WITHIN GROUP (ORDER BY b.volatility_index)::numeric,
         percentile_cont(0.6667) WITHIN GROUP (ORDER BY b.volatility_index)::numeric,
         'bootstrapped_first_observation'
    FROM _base b
   WHERE b.volatility_index IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.vol_definitions d
                      WHERE d.model_version = mv AND d.instrument = b.instrument AND d.active)
   GROUP BY b.instrument
  HAVING percentile_cont(0.3333) WITHIN GROUP (ORDER BY b.volatility_index) IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS defs_created = ROW_COUNT;

  CREATE TEMP TABLE _terc ON COMMIT DROP AS
    SELECT d.instrument, d.t1, d.t2, d.definition_version
      FROM public.vol_definitions d
     WHERE d.model_version = mv AND d.active;

  SELECT max(definition_version) INTO def_version FROM _terc;

  CREATE TEMP TABLE _tag ON COMMIT DROP AS
    SELECT b.instrument, b.direction, b.session, b.filled, b.win,
           CASE WHEN b.volatility_index IS NULL OR t.t1 IS NULL THEN 'unknown'
                WHEN b.volatility_index <= t.t1 THEN 'low'
                WHEN b.volatility_index <= t.t2 THEN 'mid'
                ELSE 'high' END AS vol_bucket
      FROM _base b
      LEFT JOIN _terc t ON t.instrument = b.instrument;

  SELECT count(*), coalesce(sum(filled), 0), coalesce(sum(win), 0)
    INTO g_n, g_fills, g_wins
    FROM _tag;

  g_pfill := CASE WHEN g_n = 0 THEN NULL ELSE g_fills::numeric / g_n END;
  g_pwin  := CASE WHEN g_fills = 0 THEN NULL ELSE g_wins::numeric / g_fills END;

  DELETE FROM regime_stats WHERE model_version = mv AND tier >= 0;

  INSERT INTO regime_stats (model_version, tier, regime_key, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at, vol_definition_version)
  VALUES (mv, 1, 'global', g_n, g_fills, g_wins,
      round(g_pfill, 6), round(g_pwin, 6),
      round(g_pfill, 6), round(g_pwin, 6), as_of, def_version);

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, n_total, n_filled, wins,
      p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2, computed_at, vol_definition_version)
  SELECT mv, 0, t.instrument, t.instrument, 0, 0, 0,
         round(g_pfill, 6), round(g_pwin, 6),
         round(t.t1, 6), round(t.t2, 6), as_of, t.definition_version
    FROM _terc t;

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at,
      vol_definition_version)
  SELECT mv, 2, a.instrument || '|' || a.direction, a.instrument, a.direction, NULL, NULL,
         a.n, a.f, a.w,
         CASE WHEN a.n = 0 THEN NULL ELSE round(a.f::numeric / a.n, 6) END,
         CASE WHEN a.f = 0 THEN NULL ELSE round(a.w::numeric / a.f, 6) END,
         CASE WHEN g_pfill IS NULL THEN NULL ELSE round((a.f + k * g_pfill) / (a.n + k), 6) END,
         CASE WHEN g_pwin  IS NULL THEN NULL ELSE round((a.w + k * g_pwin)  / (a.f + k), 6) END,
         as_of, def_version
    FROM (SELECT instrument, direction, count(*) AS n, sum(filled) AS f, sum(win) AS w
            FROM _tag GROUP BY 1, 2) a;

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at,
      vol_definition_version)
  SELECT mv, 3,
         a.instrument || '|' || a.direction || '|' || a.session || '|' || a.vol_bucket,
         a.instrument, a.direction, a.session, a.vol_bucket,
         a.n, a.f, a.w,
         CASE WHEN a.n = 0 THEN NULL ELSE round(a.f::numeric / a.n, 6) END,
         CASE WHEN a.f = 0 THEN NULL ELSE round(a.w::numeric / a.f, 6) END,
         CASE WHEN p.p_fill_shrunk IS NULL THEN NULL
              ELSE round((a.f + k * p.p_fill_shrunk) / (a.n + k), 6) END,
         CASE WHEN p.p_win_shrunk IS NULL THEN NULL
              ELSE round((a.w + k * p.p_win_shrunk) / (a.f + k), 6) END,
         as_of, def_version
    FROM (SELECT instrument, direction, session, vol_bucket,
                 count(*) AS n, sum(filled) AS f, sum(win) AS w
            FROM _tag GROUP BY 1, 2, 3, 4) a
    JOIN regime_stats p
      ON p.model_version = mv
     AND p.tier = 2
     AND p.regime_key = a.instrument || '|' || a.direction;

  SELECT count(*) INTO out_rows FROM regime_stats WHERE model_version = mv;

  INSERT INTO regime_snapshots (model_version, run_id, computed_at, tier, regime_key, instrument,
      direction, session, vol_bucket, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2, vol_definition_version)
  SELECT mv, this_run, as_of, s.tier, s.regime_key, s.instrument,
         s.direction, s.session, s.vol_bucket, s.n_total, s.n_filled, s.wins,
         s.p_fill_raw, s.p_win_raw, s.p_fill_shrunk, s.p_win_shrunk, s.vol_t1, s.vol_t2,
         s.vol_definition_version
    FROM regime_stats s
   WHERE s.model_version = mv AND s.tier >= 0;
  GET DIAGNOSTICS logged = ROW_COUNT;

  SELECT count(*) INTO logged_tier0
    FROM regime_snapshots
   WHERE run_id = this_run AND tier = 0;

  DELETE FROM regime_snapshots WHERE computed_at < as_of - interval '180 days';

  RETURN jsonb_build_object(
    'model_version', mv,
    'replay_version', 1,
    'execution_policy', 'legacy_best_target_touched',
    'cohort', 'production',
    'computed_as_of', as_of,
    'rows', out_rows,
    'resolved_samples', g_n,
    'filled_samples', g_fills,
    'wins', g_wins,
    'global_p_fill', round(g_pfill, 4),
    'global_p_win', round(g_pwin, 4),
    'legacy_resolved_at_null', legacy_null_resolved_at,
    'vol_definition_version', def_version,
    'vol_definitions_created', defs_created,
    'run_id', this_run,
    'snapshot_rows', logged,
    'snapshot_tier0_rows', logged_tier0
  );
END;
$function$;