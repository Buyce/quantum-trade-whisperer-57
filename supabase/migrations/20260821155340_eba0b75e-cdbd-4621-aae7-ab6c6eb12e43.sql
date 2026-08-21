CREATE OR REPLACE FUNCTION public.get_admin_intelligence()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '3000ms'
AS $function$
DECLARE
  v_health jsonb;
  v_engagement jsonb;
  v_fill jsonb;
  v_learning jsonb;
  v_discipline jsonb;
  v_webhooks jsonb;
  v_grade jsonb;
  v_dedup jsonb;
  v_feed jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'last_cycle_at', (SELECT max(finished_at) FROM scan_queue),
    'p50_ms', (SELECT round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY extract(epoch FROM finished_at - started_at) * 1000)::numeric, 0)
                 FROM scan_queue
                WHERE started_at IS NOT NULL AND finished_at IS NOT NULL
                  AND finished_at > now() - interval '24 hours'),
    'p95_ms', (SELECT round(percentile_cont(0.95) WITHIN GROUP (
                 ORDER BY extract(epoch FROM finished_at - started_at) * 1000)::numeric, 0)
                 FROM scan_queue
                WHERE started_at IS NOT NULL AND finished_at IS NOT NULL
                  AND finished_at > now() - interval '24 hours'),
    'jobs', coalesce((SELECT jsonb_object_agg(status, c)
                        FROM (SELECT status, count(*) AS c FROM scan_queue
                               WHERE enqueued_at > now() - interval '24 hours'
                               GROUP BY status) j), '{}'::jsonb),
    'results', coalesce((SELECT jsonb_object_agg(coalesce(result, 'unknown'), c)
                           FROM (SELECT result, count(*) AS c FROM scan_queue
                                  WHERE enqueued_at > now() - interval '24 hours'
                                  GROUP BY result) r), '{}'::jsonb),
    'backlog', (SELECT jsonb_build_object(
                  'pending', count(*),
                  'processing', (SELECT count(*) FROM scan_queue WHERE status = 'processing'),
                  'oldest_pending_at', min(enqueued_at),
                  'oldest_pending_age_min', CASE WHEN count(*) = 0 THEN NULL ELSE
                    round((extract(epoch FROM now() - min(enqueued_at)) / 60)::numeric, 1) END)
                  FROM scan_queue WHERE status = 'pending'),
    'engine', (SELECT to_jsonb(e) FROM (
                 SELECT paused, consecutive_failures, last_error, last_run_at,
                        active_replay_version, replay_v2_shadow_enabled,
                        research_errors, research_last_error, research_last_error_at
                   FROM shadow_engine_state LIMIT 1) e),
    'instruments', coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.instrument) FROM (
                 SELECT instrument, available, last_error, unavailable_until, updated_at
                   FROM instrument_health) h), '[]'::jsonb)
  ) INTO v_health;

  WITH decided AS (
    SELECT t.user_id, t.signal_id, t.user_decision::text AS decision, s.instrument
      FROM executed_trades t
      JOIN scanned_signals s ON s.id = t.signal_id
  ),
  active_users AS (
    SELECT user_id FROM executed_trades
    UNION
    SELECT user_id FROM signal_user_telemetry
  ),
  taken_r AS (
    SELECT count(*) AS n,
           round(avg(se.realized_r)::numeric, 3) AS mean_r,
           round(avg(se.ml_target_label::numeric), 4) AS win_rate
      FROM shadow_executions_production se
     WHERE se.status = 'resolved'
       AND se.replay_version = 1
       AND se.resolved_outcome <> 'never_filled'
       AND se.signal_id IN (SELECT signal_id FROM decided WHERE decision = 'taken')
  ),
  user_rep AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE t.outcome = 'win') AS wins,
           CASE WHEN count(*) = 0 THEN NULL
                ELSE round(count(*) FILTER (WHERE t.outcome = 'win')::numeric / count(*), 4)
           END AS win_rate,
           round(avg(t.realized_r_multiple)::numeric, 3) AS mean_r
      FROM executed_trades t
     WHERE t.user_decision = 'taken'
       AND t.outcome IN ('win', 'loss', 'breakeven')
  )
  SELECT jsonb_build_object(
    'active_accounts', (SELECT count(*) FROM active_users),
    'total_taken', (SELECT count(*) FROM decided WHERE decision = 'taken'),
    'total_skipped', (SELECT count(*) FROM decided WHERE decision = 'skipped'),
    'telemetry_events', (SELECT count(*) FROM signal_user_telemetry),
    'by_instrument', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.instrument) FROM (
        SELECT instrument,
               count(*) FILTER (WHERE decision = 'taken') AS taken,
               count(*) FILTER (WHERE decision = 'skipped') AS skipped
          FROM decided GROUP BY instrument) b), '[]'::jsonb),
    'taken_performance', (SELECT to_jsonb(t) FROM taken_r t),
    'user_reported', (SELECT to_jsonb(u) FROM user_rep u)
  ) INTO v_engagement;

  WITH r AS (
    SELECT coalesce(trading_session, 'unknown') AS sess,
           resolved_outcome, miss_distance_atr, detected_at
      FROM shadow_executions_production
     WHERE status = 'resolved' AND replay_version = 1
  )
  SELECT jsonb_build_object(
    'h24', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sess) FROM (
        SELECT sess,
               count(*) AS n,
               count(*) FILTER (WHERE resolved_outcome <> 'never_filled') AS filled,
               count(*) FILTER (WHERE resolved_outcome = 'never_filled') AS missed,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY
                 CASE WHEN resolved_outcome = 'never_filled' THEN miss_distance_atr END)::numeric, 3)
                 AS median_miss_atr
          FROM r WHERE detected_at > now() - interval '24 hours'
         GROUP BY sess) x), '[]'::jsonb),
    'd7', coalesce((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.sess) FROM (
        SELECT sess,
               count(*) AS n,
               count(*) FILTER (WHERE resolved_outcome <> 'never_filled') AS filled,
               count(*) FILTER (WHERE resolved_outcome = 'never_filled') AS missed,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY
                 CASE WHEN resolved_outcome = 'never_filled' THEN miss_distance_atr END)::numeric, 3)
                 AS median_miss_atr
          FROM r WHERE detected_at > now() - interval '7 days'
         GROUP BY sess) y), '[]'::jsonb)
  ) INTO v_fill;

  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.tier, l.regime_key), '[]'::jsonb)
    INTO v_learning
    FROM (
      SELECT tier, regime_key, instrument, direction, session, vol_bucket,
             n_total, n_filled, wins,
             p_fill_raw, p_win_raw, p_fill_shrunk, p_win_shrunk, computed_at,
             least(100, round(n_total::numeric / 150 * 100, 1)) AS fill_gate_pct,
             least(100, round(n_filled::numeric / 200 * 100, 1)) AS win_gate_pct,
             (n_total >= 150) AS fill_gate_passed,
             (n_filled >= 200) AS win_gate_passed
        FROM regime_stats
       WHERE tier >= 1
    ) l;

  WITH all_d AS (
    SELECT signal_id, user_decision::text AS dec FROM executed_trades
    UNION
    SELECT signal_id, event AS dec FROM signal_user_telemetry WHERE event IN ('taken', 'skipped')
  ),
  j AS (
    SELECT a.dec, se.ml_target_label, se.realized_r, se.resolved_outcome
      FROM all_d a
      JOIN shadow_executions_production se
        ON se.signal_id = a.signal_id AND se.status = 'resolved' AND se.replay_version = 1
  )
  SELECT jsonb_build_object(
    'total_decisions', (SELECT count(*) FROM all_d),
    'sufficient', (SELECT count(*) FROM all_d) >= 20,
    'taken', (SELECT to_jsonb(t) FROM (
        SELECT count(*) AS n,
               count(*) FILTER (WHERE resolved_outcome <> 'never_filled') AS filled,
               round(avg(ml_target_label::numeric) FILTER (WHERE resolved_outcome <> 'never_filled'), 4) AS win_rate,
               round(avg(realized_r) FILTER (WHERE resolved_outcome <> 'never_filled')::numeric, 3) AS mean_r
          FROM j WHERE dec = 'taken') t),
    'skipped', (SELECT to_jsonb(s) FROM (
        SELECT count(*) AS n,
               count(*) FILTER (WHERE resolved_outcome <> 'never_filled') AS filled,
               round(avg(ml_target_label::numeric) FILTER (WHERE resolved_outcome <> 'never_filled'), 4) AS win_rate,
               round(avg(realized_r) FILTER (WHERE resolved_outcome <> 'never_filled')::numeric, 3) AS mean_r
          FROM j WHERE dec = 'skipped') s)
  ) INTO v_discipline;

  SELECT jsonb_build_object(
    'total_24h', (SELECT count(*) FROM webhook_dispatch_log WHERE created_at > now() - interval '24 hours'),
    'success_rate', (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
                        round(count(*) FILTER (WHERE error IS NULL AND http_status BETWEEN 200 AND 299)::numeric
                              / count(*) * 100, 1) END
                       FROM webhook_dispatch_log WHERE created_at > now() - interval '24 hours'),
    'p95_latency_ms', (SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 0)
                         FROM webhook_dispatch_log WHERE created_at > now() - interval '24 hours'),
    'recent_errors', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC) FROM (
        SELECT created_at, signal_id, http_status, latency_ms, error
          FROM webhook_dispatch_log
         WHERE error IS NOT NULL OR http_status IS NULL OR http_status >= 400
         ORDER BY created_at DESC LIMIT 5) e), '[]'::jsonb)
  ) INTO v_webhooks;

  SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.grade), '[]'::jsonb)
    INTO v_grade
    FROM (
      SELECT grade::text AS grade,
             count(*) AS n,
             count(*) FILTER (WHERE resolved_outcome <> 'never_filled') AS filled,
             round(avg(ml_target_label::numeric) FILTER (WHERE resolved_outcome <> 'never_filled'), 4) AS win_rate,
             round(avg(realized_r)::numeric, 3) AS mean_r,
             round(avg(confidence_score)::numeric, 1) AS avg_confidence
        FROM shadow_executions_production
       WHERE status = 'resolved' AND replay_version = 1
       GROUP BY grade
    ) g;

  SELECT jsonb_build_object(
    'suppressed_24h', (SELECT count(*) FROM scan_queue
                        WHERE result = 'duplicate' AND enqueued_at > now() - interval '24 hours'),
    'suppressed_7d', (SELECT count(*) FROM scan_queue
                        WHERE result = 'duplicate' AND enqueued_at > now() - interval '7 days'),
    'published_24h', (SELECT count(*) FROM scan_queue
                        WHERE result = 'published' AND enqueued_at > now() - interval '24 hours')
  ) INTO v_dedup;

  WITH recent AS (
    SELECT id, instrument, grade::text AS grade, direction::text AS direction,
           detected_at, status, confidence_score
      FROM scanned_signals
     ORDER BY detected_at DESC
     LIMIT 200
  )
  SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.detected_at DESC), '[]'::jsonb)
    INTO v_feed
    FROM (
      SELECT s.id, s.instrument, s.grade, s.direction, s.detected_at, s.status,
             round(s.confidence_score::numeric, 1) AS confidence_score,
             mc.trading_session,
             (SELECT count(*) FROM (
                SELECT user_id FROM executed_trades
                 WHERE signal_id = s.id AND user_decision = 'taken'
                UNION
                SELECT user_id FROM signal_user_telemetry
                 WHERE signal_id = s.id AND event = 'taken') q) AS taken_count,
             (SELECT count(*) FROM (
                SELECT user_id FROM executed_trades
                 WHERE signal_id = s.id AND user_decision = 'skipped'
                UNION
                SELECT user_id FROM signal_user_telemetry
                 WHERE signal_id = s.id AND event = 'skipped') q) AS skipped_count,
             se.status AS shadow_status,
             se.resolved_outcome,
             round(se.realized_r::numeric, 3) AS realized_r,
             round(se.miss_distance_atr::numeric, 3) AS miss_distance_atr
        FROM recent s
        LEFT JOIN market_context mc ON mc.signal_id = s.id
        LEFT JOIN shadow_executions_production se
          ON se.signal_id = s.id AND se.replay_version = 1
    ) f;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'health', v_health,
    'engagement', v_engagement,
    'fill_diagnostic', v_fill,
    'learning_matrix', v_learning,
    'discipline', v_discipline,
    'webhooks', v_webhooks,
    'grade_calibration', v_grade,
    'dedup_pressure', v_dedup,
    'intersection_feed', v_feed
  );
END;
$function$;