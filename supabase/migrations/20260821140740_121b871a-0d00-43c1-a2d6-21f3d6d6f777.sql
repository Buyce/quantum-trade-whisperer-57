-- 6A: safety + truth release.
-- 1) Statistically undefined probabilities become NULL instead of a fabricated 0.5.
ALTER TABLE public.regime_stats     ALTER COLUMN p_fill_shrunk DROP NOT NULL;
ALTER TABLE public.regime_stats     ALTER COLUMN p_win_shrunk  DROP NOT NULL;
ALTER TABLE public.regime_snapshots ALTER COLUMN p_fill_shrunk DROP NOT NULL;
ALTER TABLE public.regime_snapshots ALTER COLUMN p_win_shrunk  DROP NOT NULL;

-- 2) Dual-write column for the truthfully named joint win probability.
--    ev_prior keeps its original meaning and is never redefined or backfilled.
ALTER TABLE public.scanned_signals ADD COLUMN IF NOT EXISTS p_joint_prior numeric;

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
BEGIN
  -- 6E.5 Hard model lock: live regime_stats is production model V1 only.
  IF mv <> 1 THEN
    RETURN jsonb_build_object(
      'skipped', 'model_version_not_promoted',
      'model_version', mv,
      'production_model_version', 1
    );
  END IF;

  -- Serialise the whole rebuild so no reader sees a half-built table and no two
  -- runs interleave their as_of stamps.
  PERFORM pg_advisory_xact_lock(hashtext('recompute_regime_stats'), mv);
  as_of := clock_timestamp();

  -- 6E.4 point-in-time, contamination-filtered production source.
  -- Production tuple is exactly (model 1, replay 1, legacy_best_target_touched).
  -- A row counts as resolved for this run only if its resolution existed by as_of.
  -- Legacy rule: resolved rows written before resolution stamping (resolved_at
  -- IS NULL) are preserved, treated as resolved at their last poll / detection
  -- time, so no historical training observation is silently dropped.
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
       AND detected_at <= as_of
       AND coalesce(resolved_at, last_polled_at, detected_at) <= as_of;

  SELECT count(*) FILTER (WHERE legacy_resolved_at_null)
    INTO legacy_null_resolved_at FROM _regime_src;

  CREATE TEMP TABLE _base ON COMMIT DROP AS
    SELECT instrument, direction, session, volatility_index, filled, win FROM _regime_src;

  -- Terciles are per instrument: gold and EURUSD do not share a volatility scale.
  CREATE TEMP TABLE _terc ON COMMIT DROP AS
    SELECT instrument,
           percentile_cont(0.3333) WITHIN GROUP (ORDER BY volatility_index)::numeric AS t1,
           percentile_cont(0.6667) WITHIN GROUP (ORDER BY volatility_index)::numeric AS t2
      FROM _base
     WHERE volatility_index IS NOT NULL
     GROUP BY instrument;

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

  -- 6E.8 An empty denominator has no probability. NULL, never a fabricated 0.5.
  g_pfill := CASE WHEN g_n = 0 THEN NULL ELSE g_fills::numeric / g_n END;
  g_pwin  := CASE WHEN g_fills = 0 THEN NULL ELSE g_wins::numeric / g_fills END;

  DELETE FROM regime_stats WHERE model_version = mv AND tier >= 0;

  INSERT INTO regime_stats (model_version, tier, regime_key, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
  VALUES (mv, 1, 'global', g_n, g_fills, g_wins,
      round(g_pfill, 6), round(g_pwin, 6),
      round(g_pfill, 6), round(g_pwin, 6), as_of);

  -- Tier 0: volatility tercile boundaries, read by the live scanner.
  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, n_total, n_filled, wins,
      p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2, computed_at)
  SELECT mv, 0, t.instrument, t.instrument, 0, 0, 0,
         round(g_pfill, 6), round(g_pwin, 6),
         round(t.t1, 6), round(t.t2, 6), as_of
    FROM _terc t;

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
  SELECT mv, 2, a.instrument || '|' || a.direction, a.instrument, a.direction, NULL, NULL,
         a.n, a.f, a.w,
         CASE WHEN a.n = 0 THEN NULL ELSE round(a.f::numeric / a.n, 6) END,
         CASE WHEN a.f = 0 THEN NULL ELSE round(a.w::numeric / a.f, 6) END,
         CASE WHEN g_pfill IS NULL THEN NULL ELSE round((a.f + k * g_pfill) / (a.n + k), 6) END,
         CASE WHEN g_pwin  IS NULL THEN NULL ELSE round((a.w + k * g_pwin)  / (a.f + k), 6) END,
         as_of
    FROM (SELECT instrument, direction, count(*) AS n, sum(filled) AS f, sum(win) AS w
            FROM _tag GROUP BY 1, 2) a;

  INSERT INTO regime_stats (model_version, tier, regime_key, instrument, direction, session, vol_bucket,
      n_total, n_filled, wins, p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at)
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
         as_of
    FROM (SELECT instrument, direction, session, vol_bucket,
                 count(*) AS n, sum(filled) AS f, sum(win) AS w
            FROM _tag GROUP BY 1, 2, 3, 4) a
    JOIN regime_stats p
      ON p.model_version = mv
     AND p.tier = 2
     AND p.regime_key = a.instrument || '|' || a.direction;

  SELECT count(*) INTO out_rows FROM regime_stats WHERE model_version = mv;

  -- Training-data history: append this iteration verbatim, stamped with the same
  -- locked as_of so one timestamp identifies the entire run.
  INSERT INTO regime_snapshots (model_version, run_id, computed_at, tier, regime_key, instrument,
      direction, session, vol_bucket, n_total, n_filled, wins,
      p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, vol_t1, vol_t2)
  SELECT mv, this_run, as_of, s.tier, s.regime_key, s.instrument,
         s.direction, s.session, s.vol_bucket, s.n_total, s.n_filled, s.wins,
         s.p_fill_raw, s.p_win_raw, s.p_fill_shrunk, s.p_win_shrunk, s.vol_t1, s.vol_t2
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
    'computed_as_of', as_of,
    'rows', out_rows,
    'resolved_samples', g_n,
    'filled_samples', g_fills,
    'wins', g_wins,
    'global_p_fill', round(g_pfill, 4),
    'global_p_win', round(g_pwin, 4),
    'legacy_resolved_at_null', legacy_null_resolved_at,
    'run_id', this_run,
    'snapshot_rows', logged,
    'snapshot_tier0_rows', logged_tier0
  );
END;
$function$;