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
    WHEN 'archived_signals' THEN
      v_table := 'signal_retention_archive';
      v_time_col := 'detected_at';
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

  IF _dataset = 'archived_signals' THEN
    v_withheld := ARRAY['related_snapshots'];
  END IF;

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
    WHEN 'archived_signals' THEN v_table := 'signal_retention_archive'; v_time_col := 'detected_at';
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