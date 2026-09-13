CREATE OR REPLACE FUNCTION public.read_training_dataset(
  _dataset text,
  _since timestamptz,
  _until timestamptz,
  _limit integer DEFAULT 500,
  _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_table text;
  v_time_col text;
  v_withheld text[] := ARRAY[]::text[];
  v_limit integer := least(greatest(coalesce(_limit, 500), 1), 5000);
  v_offset integer := greatest(coalesce(_offset, 0), 0);
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  CASE _dataset
    WHEN 'signals' THEN v_table := 'scanned_signals'; v_time_col := 'detected_at';
    WHEN 'shadow_replay' THEN v_table := 'shadow_executions'; v_time_col := 'detected_at';
    WHEN 'research_candidates' THEN v_table := 'research_candidates'; v_time_col := 'detected_at';
    WHEN 'broker_trades' THEN
      v_table := 'broker_trade_evidence';
      v_time_col := 'first_observed_at';
      v_withheld := ARRAY[
        'user_id','account_id','metaapi_account_id','client_id','magic',
        'broker_order_id','broker_position_id','delivery_id','deals','research_account_ref'
      ];
    WHEN 'payoff_stats' THEN v_table := 'payoff_stats'; v_time_col := 'computed_as_of';
    WHEN 'regime_stats' THEN v_table := 'regime_stats'; v_time_col := 'computed_at';
    WHEN 'filter_lift_stats' THEN v_table := 'filter_lift_stats'; v_time_col := 'computed_as_of';
    WHEN 'spread_stats' THEN v_table := 'instrument_spread_stats'; v_time_col := 'calculated_at';
    ELSE RAISE EXCEPTION 'unknown dataset: %', _dataset;
  END CASE;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(to_jsonb(t) - $3), ''[]''::jsonb)
       FROM (SELECT * FROM public.%I
              WHERE %I >= $1 AND %I < $2
              ORDER BY %I ASC
              LIMIT %s OFFSET %s) t',
    v_table, v_time_col, v_time_col, v_time_col, v_limit, v_offset
  )
  INTO v_rows
  USING _since, _until, v_withheld;

  RETURN jsonb_build_object(
    'dataset', _dataset,
    'table', v_table,
    'time_column', v_time_col,
    'since', _since,
    'until', _until,
    'limit', v_limit,
    'offset', v_offset,
    'withheld_columns', to_jsonb(v_withheld),
    'row_count', jsonb_array_length(v_rows),
    'rows', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.count_training_dataset(
  _dataset text,
  _since timestamptz,
  _until timestamptz
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_table text;
  v_time_col text;
  v_count bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  CASE _dataset
    WHEN 'signals' THEN v_table := 'scanned_signals'; v_time_col := 'detected_at';
    WHEN 'shadow_replay' THEN v_table := 'shadow_executions'; v_time_col := 'detected_at';
    WHEN 'research_candidates' THEN v_table := 'research_candidates'; v_time_col := 'detected_at';
    WHEN 'broker_trades' THEN v_table := 'broker_trade_evidence'; v_time_col := 'first_observed_at';
    WHEN 'payoff_stats' THEN v_table := 'payoff_stats'; v_time_col := 'computed_as_of';
    WHEN 'regime_stats' THEN v_table := 'regime_stats'; v_time_col := 'computed_at';
    WHEN 'filter_lift_stats' THEN v_table := 'filter_lift_stats'; v_time_col := 'computed_as_of';
    WHEN 'spread_stats' THEN v_table := 'instrument_spread_stats'; v_time_col := 'calculated_at';
    ELSE RAISE EXCEPTION 'unknown dataset: %', _dataset;
  END CASE;

  EXECUTE format(
    'SELECT count(*) FROM public.%I WHERE %I >= $1 AND %I < $2',
    v_table, v_time_col, v_time_col
  )
  INTO v_count
  USING _since, _until;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.read_training_dataset(text, timestamptz, timestamptz, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_training_dataset(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_training_dataset(text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_training_dataset(text, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.read_training_dataset(text, timestamptz, timestamptz, integer, integer) IS
  'Owner-gated, read-only paged read of a whitelisted training dataset over an explicit time window. Withholds account-identifying columns. Returns only real recorded rows.';
COMMENT ON FUNCTION public.count_training_dataset(text, timestamptz, timestamptz) IS
  'Owner-gated exact row count for a whitelisted training dataset over an explicit time window.';

COMMENT ON TABLE public.scanned_signals IS
  'Published scanner setups. Written only by the scanner pipeline from real MetaApi candles. Prices are broker-derived; grades, R multiples and priors are engine-derived. Never seeded with synthetic rows.';
COMMENT ON TABLE public.shadow_executions IS
  'Deterministic replay of setups over stored candles. Replay-derived: no order was ever placed. Used for learning statistics, never presented as live performance.';
COMMENT ON TABLE public.research_candidates IS
  'Structures captured before publication, with the full gate record. Exists to remove selection bias from learning: rejected candidates are retained.';
COMMENT ON TABLE public.broker_trade_evidence IS
  'Broker-reported trade facts positively associated with an account or delivery. The only authoritative source of realised money and win/loss.';
COMMENT ON TABLE public.executed_trades IS
  'The user-maintained journal. Self-reported prices and outcomes; never merged with broker evidence.';
COMMENT ON TABLE public.payoff_stats IS
  'Expected R per cohort computed over the full payoff distribution, with clustered confidence intervals and reporting-gate status.';
COMMENT ON TABLE public.regime_stats IS
  'Hierarchically shrunk fill and TP1-if-filled rates per regime bucket. Descriptive in-sample replay rates.';
COMMENT ON TABLE public.filter_lift_stats IS
  'Counterfactual mean R of setups a gate rejected. Only gates that reject after entry/stop geometry exists can produce a value.';
COMMENT ON TABLE public.instrument_spread_stats IS
  'Sampled spread distributions per instrument and session, with coverage and missingness. Broker-derived from quote samples.';
COMMENT ON TABLE public.execution_enqueue_decisions IS
  'Every automatic-order decision with the engine''s exact refusal reason. Append-only audit trail.';
COMMENT ON TABLE public.instrument_lifecycle IS
  'Current lifecycle stage per instrument. Automatic advancement can only promote or hold; demotion is human-audited only.';
COMMENT ON TABLE public.market_context IS
  'Trading session and volatility context attached to a signal. Measurement-only: it never gates, resizes or reorders an order.';

COMMENT ON COLUMN public.scanned_signals.confidence_score IS
  'Rule-satisfaction score 0-100. Not a win probability.';
COMMENT ON COLUMN public.scanned_signals.max_r IS
  'Highest reachable R of the published geometry, engine-derived.';
COMMENT ON COLUMN public.scanned_signals.ev_prior IS
  'Descriptive prior expected R at publication. An estimate, not a forecast.';
COMMENT ON COLUMN public.shadow_executions.realized_r IS
  'Replay-derived R over stored candles. No money was at risk.';
COMMENT ON COLUMN public.shadow_executions.execution_policy IS
  'Exit policy the replay applied (for example single_exit_first_target, partial_tp1_runner_tp2).';
COMMENT ON COLUMN public.broker_trade_evidence.r_vs_actual_risk IS
  'Realised R against the risk actually taken at the broker. Canonical basis.';
COMMENT ON COLUMN public.broker_trade_evidence.r_vs_plan IS
  'Realised R against the published plan risk. Never averaged with r_vs_actual_risk.';
COMMENT ON COLUMN public.broker_trade_evidence.broker_account_type IS
  'demo or live as reported by the broker. Demo evidence is not a live track record.';
COMMENT ON COLUMN public.payoff_stats.stat_status IS
  'Reporting-gate verdict: whether the cohort has enough resolved coverage to be reported at all.';
COMMENT ON COLUMN public.instrument_spread_stats.missingness IS
  'Fraction of samples excluded as unusable quotes. High missingness invalidates the distribution.';