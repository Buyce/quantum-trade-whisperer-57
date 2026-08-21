export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agent_registrations: {
        Row: {
          client_label: string | null
          created_at: string
          email_hash: string
          id: string
          ip_hash: string
        }
        Insert: {
          client_label?: string | null
          created_at?: string
          email_hash: string
          id?: string
          ip_hash: string
        }
        Update: {
          client_label?: string | null
          created_at?: string
          email_hash?: string
          id?: string
          ip_hash?: string
        }
        Relationships: []
      }
      baseline_snapshots: {
        Row: {
          captured_at: string
          id: string
          kind: string
          metrics: Json
          model_version: number
          pinned_run_id: string | null
        }
        Insert: {
          captured_at?: string
          id?: string
          kind?: string
          metrics: Json
          model_version?: number
          pinned_run_id?: string | null
        }
        Update: {
          captured_at?: string
          id?: string
          kind?: string
          metrics?: Json
          model_version?: number
          pinned_run_id?: string | null
        }
        Relationships: []
      }
      executed_trades: {
        Row: {
          actual_entry_price: number | null
          actual_exit_price: number | null
          created_at: string
          decision_source: string
          decision_source_client: string | null
          derived_r: number | null
          id: string
          notes: string | null
          outcome: Database["public"]["Enums"]["trade_outcome"]
          price_recorded_at: string | null
          price_source: string | null
          price_source_client: string | null
          realized_r_multiple: number | null
          signal_id: string
          updated_at: string
          user_decision: Database["public"]["Enums"]["decision_kind"]
          user_id: string
        }
        Insert: {
          actual_entry_price?: number | null
          actual_exit_price?: number | null
          created_at?: string
          decision_source?: string
          decision_source_client?: string | null
          derived_r?: number | null
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["trade_outcome"]
          price_recorded_at?: string | null
          price_source?: string | null
          price_source_client?: string | null
          realized_r_multiple?: number | null
          signal_id: string
          updated_at?: string
          user_decision: Database["public"]["Enums"]["decision_kind"]
          user_id?: string
        }
        Update: {
          actual_entry_price?: number | null
          actual_exit_price?: number | null
          created_at?: string
          decision_source?: string
          decision_source_client?: string | null
          derived_r?: number | null
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["trade_outcome"]
          price_recorded_at?: string | null
          price_source?: string | null
          price_source_client?: string | null
          realized_r_multiple?: number | null
          signal_id?: string
          updated_at?: string
          user_decision?: Database["public"]["Enums"]["decision_kind"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "executed_trades_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          category: string
          contact_email: string | null
          created_at: string
          id: string
          message: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          contact_email?: string | null
          created_at?: string
          id?: string
          message: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          category?: string
          contact_email?: string | null
          created_at?: string
          id?: string
          message?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      filter_lift_stats: {
        Row: {
          arm: string
          cluster_n: number | null
          computed_as_of: string
          coverage_threshold: number
          gate: string
          manifest_hash: string
          mean_r: number | null
          n_candidates: number
          n_mature: number
          n_resolved: number
          n_used: number
          reason: string | null
          replay_coverage: number | null
          run_id: string
          sd_r: number | null
          se_r: number | null
          stat_status: string
          strategy_version: number
          terminal_replay_horizon_hours: number
        }
        Insert: {
          arm: string
          cluster_n?: number | null
          computed_as_of?: string
          coverage_threshold?: number
          gate: string
          manifest_hash: string
          mean_r?: number | null
          n_candidates: number
          n_mature: number
          n_resolved: number
          n_used: number
          reason?: string | null
          replay_coverage?: number | null
          run_id: string
          sd_r?: number | null
          se_r?: number | null
          stat_status: string
          strategy_version: number
          terminal_replay_horizon_hours: number
        }
        Update: {
          arm?: string
          cluster_n?: number | null
          computed_as_of?: string
          coverage_threshold?: number
          gate?: string
          manifest_hash?: string
          mean_r?: number | null
          n_candidates?: number
          n_mature?: number
          n_resolved?: number
          n_used?: number
          reason?: string | null
          replay_coverage?: number | null
          run_id?: string
          sd_r?: number | null
          se_r?: number | null
          stat_status?: string
          strategy_version?: number
          terminal_replay_horizon_hours?: number
        }
        Relationships: []
      }
      instrument_health: {
        Row: {
          available: boolean
          instrument: string
          last_error: string | null
          unavailable_until: string | null
          updated_at: string
        }
        Insert: {
          available?: boolean
          instrument: string
          last_error?: string | null
          unavailable_until?: string | null
          updated_at?: string
        }
        Update: {
          available?: boolean
          instrument?: string
          last_error?: string | null
          unavailable_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      market_context: {
        Row: {
          created_at: string
          day_of_week: number
          id: string
          signal_id: string
          time_of_day: number
          trading_session: string
          volatility_index: number | null
        }
        Insert: {
          created_at?: string
          day_of_week: number
          id?: string
          signal_id: string
          time_of_day: number
          trading_session: string
          volatility_index?: number | null
        }
        Update: {
          created_at?: string
          day_of_week?: number
          id?: string
          signal_id?: string
          time_of_day?: number
          trading_session?: string
          volatility_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_context_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      model_observations: {
        Row: {
          code_hash: string | null
          decision: string
          direction: string | null
          disposition: string
          family: string | null
          grade: string | null
          id: string
          instrument: string
          latency_ms: number | null
          model_version: number
          observation_key: string | null
          observed_at: string
          profile: Json | null
          reason: string | null
          run_id: string | null
          signal_id: string | null
        }
        Insert: {
          code_hash?: string | null
          decision: string
          direction?: string | null
          disposition?: string
          family?: string | null
          grade?: string | null
          id?: string
          instrument: string
          latency_ms?: number | null
          model_version: number
          observation_key?: string | null
          observed_at?: string
          profile?: Json | null
          reason?: string | null
          run_id?: string | null
          signal_id?: string | null
        }
        Update: {
          code_hash?: string | null
          decision?: string
          direction?: string | null
          disposition?: string
          family?: string | null
          grade?: string | null
          id?: string
          instrument?: string
          latency_ms?: number | null
          model_version?: number
          observation_key?: string | null
          observed_at?: string
          profile?: Json | null
          reason?: string | null
          run_id?: string | null
          signal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "model_observations_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      model_versions: {
        Row: {
          activated_at: string
          code_hash: string | null
          components: Json
          label: string
          notes: string | null
          retired_at: string | null
          version: number
        }
        Insert: {
          activated_at?: string
          code_hash?: string | null
          components?: Json
          label: string
          notes?: string | null
          retired_at?: string | null
          version: number
        }
        Update: {
          activated_at?: string
          code_hash?: string | null
          components?: Json
          label?: string
          notes?: string | null
          retired_at?: string | null
          version?: number
        }
        Relationships: []
      }
      payoff_snapshots: {
        Row: {
          ci_df: number | null
          ci_hi: number | null
          ci_level: number | null
          ci_lo: number | null
          ci_method: string | null
          cluster_n: number | null
          computed_as_of: string
          coverage_threshold: number
          direction: string | null
          estimand: string
          execution_policy: string
          id: string
          instrument: string | null
          mean_r: number | null
          model_version: number
          n_executable: number
          n_gap_no_trade: number
          n_invalid_excluded: number
          n_legacy_resolved_at_null: number
          n_mature: number
          n_never_filled: number
          n_per_plan_eligible: number
          n_resolved_total: number
          n_unresolved_mature: number
          n_used: number
          payoff_basis: string
          reason: string | null
          regime_key: string
          replay_coverage: number | null
          replay_version: number
          run_id: string
          sd_r: number | null
          se_r: number | null
          stat_status: string
          terminal_replay_horizon_hours: number
          tier: number
        }
        Insert: {
          ci_df?: number | null
          ci_hi?: number | null
          ci_level?: number | null
          ci_lo?: number | null
          ci_method?: string | null
          cluster_n?: number | null
          computed_as_of: string
          coverage_threshold?: number
          direction?: string | null
          estimand: string
          execution_policy: string
          id?: string
          instrument?: string | null
          mean_r?: number | null
          model_version: number
          n_executable?: number
          n_gap_no_trade?: number
          n_invalid_excluded?: number
          n_legacy_resolved_at_null?: number
          n_mature?: number
          n_never_filled?: number
          n_per_plan_eligible?: number
          n_resolved_total?: number
          n_unresolved_mature?: number
          n_used?: number
          payoff_basis: string
          reason?: string | null
          regime_key: string
          replay_coverage?: number | null
          replay_version: number
          run_id: string
          sd_r?: number | null
          se_r?: number | null
          stat_status: string
          terminal_replay_horizon_hours: number
          tier: number
        }
        Update: {
          ci_df?: number | null
          ci_hi?: number | null
          ci_level?: number | null
          ci_lo?: number | null
          ci_method?: string | null
          cluster_n?: number | null
          computed_as_of?: string
          coverage_threshold?: number
          direction?: string | null
          estimand?: string
          execution_policy?: string
          id?: string
          instrument?: string | null
          mean_r?: number | null
          model_version?: number
          n_executable?: number
          n_gap_no_trade?: number
          n_invalid_excluded?: number
          n_legacy_resolved_at_null?: number
          n_mature?: number
          n_never_filled?: number
          n_per_plan_eligible?: number
          n_resolved_total?: number
          n_unresolved_mature?: number
          n_used?: number
          payoff_basis?: string
          reason?: string | null
          regime_key?: string
          replay_coverage?: number | null
          replay_version?: number
          run_id?: string
          sd_r?: number | null
          se_r?: number | null
          stat_status?: string
          terminal_replay_horizon_hours?: number
          tier?: number
        }
        Relationships: []
      }
      payoff_stats: {
        Row: {
          ci_df: number | null
          ci_hi: number | null
          ci_level: number | null
          ci_lo: number | null
          ci_method: string | null
          cluster_n: number | null
          computed_as_of: string
          coverage_threshold: number
          direction: string | null
          estimand: string
          execution_policy: string
          instrument: string | null
          mean_r: number | null
          model_version: number
          n_executable: number
          n_gap_no_trade: number
          n_invalid_excluded: number
          n_legacy_resolved_at_null: number
          n_mature: number
          n_never_filled: number
          n_per_plan_eligible: number
          n_resolved_total: number
          n_unresolved_mature: number
          n_used: number
          payoff_basis: string
          reason: string | null
          regime_key: string
          replay_coverage: number | null
          replay_version: number
          run_id: string
          sd_r: number | null
          se_r: number | null
          stat_status: string
          terminal_replay_horizon_hours: number
          tier: number
        }
        Insert: {
          ci_df?: number | null
          ci_hi?: number | null
          ci_level?: number | null
          ci_lo?: number | null
          ci_method?: string | null
          cluster_n?: number | null
          computed_as_of?: string
          coverage_threshold?: number
          direction?: string | null
          estimand: string
          execution_policy: string
          instrument?: string | null
          mean_r?: number | null
          model_version: number
          n_executable?: number
          n_gap_no_trade?: number
          n_invalid_excluded?: number
          n_legacy_resolved_at_null?: number
          n_mature?: number
          n_never_filled?: number
          n_per_plan_eligible?: number
          n_resolved_total?: number
          n_unresolved_mature?: number
          n_used?: number
          payoff_basis: string
          reason?: string | null
          regime_key: string
          replay_coverage?: number | null
          replay_version: number
          run_id: string
          sd_r?: number | null
          se_r?: number | null
          stat_status: string
          terminal_replay_horizon_hours: number
          tier: number
        }
        Update: {
          ci_df?: number | null
          ci_hi?: number | null
          ci_level?: number | null
          ci_lo?: number | null
          ci_method?: string | null
          cluster_n?: number | null
          computed_as_of?: string
          coverage_threshold?: number
          direction?: string | null
          estimand?: string
          execution_policy?: string
          instrument?: string | null
          mean_r?: number | null
          model_version?: number
          n_executable?: number
          n_gap_no_trade?: number
          n_invalid_excluded?: number
          n_legacy_resolved_at_null?: number
          n_mature?: number
          n_never_filled?: number
          n_per_plan_eligible?: number
          n_resolved_total?: number
          n_unresolved_mature?: number
          n_used?: number
          payoff_basis?: string
          reason?: string | null
          regime_key?: string
          replay_coverage?: number | null
          replay_version?: number
          run_id?: string
          sd_r?: number | null
          se_r?: number | null
          stat_status?: string
          terminal_replay_horizon_hours?: number
          tier?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deletion_requested_at: string | null
          deletion_scheduled_for: string | null
          display_name: string | null
          id: string
          signup_client: string | null
          signup_source: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          deletion_scheduled_for?: string | null
          display_name?: string | null
          id: string
          signup_client?: string | null
          signup_source?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          deletion_scheduled_for?: string | null
          display_name?: string | null
          id?: string
          signup_client?: string | null
          signup_source?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      regime_snapshots: {
        Row: {
          computed_at: string
          direction: string | null
          id: string
          instrument: string | null
          model_version: number
          n_filled: number
          n_total: number
          p_fill_raw: number | null
          p_fill_shrunk: number | null
          p_win_raw: number | null
          p_win_shrunk: number | null
          regime_key: string
          run_id: string
          session: string | null
          tier: number
          vol_bucket: string | null
          vol_definition_version: number | null
          vol_t1: number | null
          vol_t2: number | null
          wins: number
        }
        Insert: {
          computed_at?: string
          direction?: string | null
          id?: string
          instrument?: string | null
          model_version?: number
          n_filled?: number
          n_total?: number
          p_fill_raw?: number | null
          p_fill_shrunk?: number | null
          p_win_raw?: number | null
          p_win_shrunk?: number | null
          regime_key: string
          run_id: string
          session?: string | null
          tier: number
          vol_bucket?: string | null
          vol_definition_version?: number | null
          vol_t1?: number | null
          vol_t2?: number | null
          wins?: number
        }
        Update: {
          computed_at?: string
          direction?: string | null
          id?: string
          instrument?: string | null
          model_version?: number
          n_filled?: number
          n_total?: number
          p_fill_raw?: number | null
          p_fill_shrunk?: number | null
          p_win_raw?: number | null
          p_win_shrunk?: number | null
          regime_key?: string
          run_id?: string
          session?: string | null
          tier?: number
          vol_bucket?: string | null
          vol_definition_version?: number | null
          vol_t1?: number | null
          vol_t2?: number | null
          wins?: number
        }
        Relationships: []
      }
      regime_stats: {
        Row: {
          computed_at: string
          direction: string | null
          instrument: string | null
          model_version: number
          n_filled: number
          n_total: number
          p_fill_raw: number | null
          p_fill_shrunk: number | null
          p_win_raw: number | null
          p_win_shrunk: number | null
          regime_key: string
          session: string | null
          tier: number
          vol_bucket: string | null
          vol_definition_version: number | null
          vol_t1: number | null
          vol_t2: number | null
          wins: number
        }
        Insert: {
          computed_at?: string
          direction?: string | null
          instrument?: string | null
          model_version?: number
          n_filled?: number
          n_total?: number
          p_fill_raw?: number | null
          p_fill_shrunk?: number | null
          p_win_raw?: number | null
          p_win_shrunk?: number | null
          regime_key: string
          session?: string | null
          tier: number
          vol_bucket?: string | null
          vol_definition_version?: number | null
          vol_t1?: number | null
          vol_t2?: number | null
          wins?: number
        }
        Update: {
          computed_at?: string
          direction?: string | null
          instrument?: string | null
          model_version?: number
          n_filled?: number
          n_total?: number
          p_fill_raw?: number | null
          p_fill_shrunk?: number | null
          p_win_raw?: number | null
          p_win_shrunk?: number | null
          regime_key?: string
          session?: string | null
          tier?: number
          vol_bucket?: string | null
          vol_definition_version?: number | null
          vol_t1?: number | null
          vol_t2?: number | null
          wins?: number
        }
        Relationships: []
      }
      replay_versions: {
        Row: {
          code_hash: string
          label: string
          registered_at: string
          retired_at: string | null
          semantics: Json
          version: number
        }
        Insert: {
          code_hash: string
          label: string
          registered_at?: string
          retired_at?: string | null
          semantics: Json
          version: number
        }
        Update: {
          code_hash?: string
          label?: string
          registered_at?: string
          retired_at?: string | null
          semantics?: Json
          version?: number
        }
        Relationships: []
      }
      research_candidates: {
        Row: {
          atr: number | null
          code_hash: string | null
          confidence_score: number | null
          created_at: string
          detected_at: string
          direction: string | null
          enrolled_at: string | null
          enrolled_plan_id: string | null
          entry_price: number | null
          features: Json | null
          gates: Json
          gates_complete: boolean
          grade: string | null
          id: string
          instrument: string
          manifest_hash: string
          max_r: number | null
          observation_key: string | null
          published_signal_id: string | null
          risk_price: number | null
          run_id: string | null
          stop_loss: number | null
          strategy_version: number
          structure_key: string | null
          terminal_stage: string
          tp1: number | null
          tp1_r: number | null
          tp2: number | null
          tp2_r: number | null
          tp3: number | null
          tp3_r: number | null
          trading_session: string | null
          v1_decision: string
          volatility_index: number | null
        }
        Insert: {
          atr?: number | null
          code_hash?: string | null
          confidence_score?: number | null
          created_at?: string
          detected_at?: string
          direction?: string | null
          enrolled_at?: string | null
          enrolled_plan_id?: string | null
          entry_price?: number | null
          features?: Json | null
          gates?: Json
          gates_complete?: boolean
          grade?: string | null
          id?: string
          instrument: string
          manifest_hash: string
          max_r?: number | null
          observation_key?: string | null
          published_signal_id?: string | null
          risk_price?: number | null
          run_id?: string | null
          stop_loss?: number | null
          strategy_version?: number
          structure_key?: string | null
          terminal_stage: string
          tp1?: number | null
          tp1_r?: number | null
          tp2?: number | null
          tp2_r?: number | null
          tp3?: number | null
          tp3_r?: number | null
          trading_session?: string | null
          v1_decision: string
          volatility_index?: number | null
        }
        Update: {
          atr?: number | null
          code_hash?: string | null
          confidence_score?: number | null
          created_at?: string
          detected_at?: string
          direction?: string | null
          enrolled_at?: string | null
          enrolled_plan_id?: string | null
          entry_price?: number | null
          features?: Json | null
          gates?: Json
          gates_complete?: boolean
          grade?: string | null
          id?: string
          instrument?: string
          manifest_hash?: string
          max_r?: number | null
          observation_key?: string | null
          published_signal_id?: string | null
          risk_price?: number | null
          run_id?: string | null
          stop_loss?: number | null
          strategy_version?: number
          structure_key?: string | null
          terminal_stage?: string
          tp1?: number | null
          tp1_r?: number | null
          tp2?: number | null
          tp2_r?: number | null
          tp3?: number | null
          tp3_r?: number | null
          trading_session?: string | null
          v1_decision?: string
          volatility_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "research_candidates_published_signal_id_fkey"
            columns: ["published_signal_id"]
            isOneToOne: false
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_queue: {
        Row: {
          attempts: number
          enqueued_at: string
          error: string | null
          finished_at: string | null
          id: number
          instrument: string
          payload: Json | null
          processed_at: string | null
          result: string | null
          run_id: string | null
          started_at: string | null
          status: string
          timeframe: Database["public"]["Enums"]["tf_code"] | null
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          error?: string | null
          finished_at?: string | null
          id?: number
          instrument: string
          payload?: Json | null
          processed_at?: string | null
          result?: string | null
          run_id?: string | null
          started_at?: string | null
          status?: string
          timeframe?: Database["public"]["Enums"]["tf_code"] | null
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          error?: string | null
          finished_at?: string | null
          id?: number
          instrument?: string
          payload?: Json | null
          processed_at?: string | null
          result?: string | null
          run_id?: string | null
          started_at?: string | null
          status?: string
          timeframe?: Database["public"]["Enums"]["tf_code"] | null
        }
        Relationships: []
      }
      scanned_signals: {
        Row: {
          atr: number
          c_alignment: number
          c_rr: number
          c_symmetry: number
          c_volatility: number
          confidence_score: number
          created_at: string
          detected_at: string
          direction: Database["public"]["Enums"]["trade_direction"]
          entry_price: number
          ev_prior: number | null
          expired_at: string | null
          grade: Database["public"]["Enums"]["signal_grade"]
          h1_bias: string | null
          h4_bias: string | null
          id: string
          instrument: string
          m15_bias: string | null
          max_acceptable_entry: number | null
          max_r: number | null
          model_version: number
          observation_key: string | null
          p_fill_prior: number | null
          p_joint_prior: number | null
          p_momentum: number | null
          p_order_block: number | null
          p_trend: number | null
          p_volatility_expansion: number | null
          p_win_prior: number | null
          pattern_symmetry: number
          pillars_passed: number | null
          prior_filled_n: number | null
          prior_sample_n: number | null
          prior_tier: number | null
          qualitative_breakdown: string
          resolved_outcome: Database["public"]["Enums"]["trade_outcome"]
          resolved_r_multiple: number | null
          rr_ratio: number
          status: string
          stop_loss: number
          structure_key: string | null
          tp1: number
          tp1_r: number | null
          tp2: number
          tp2_r: number | null
          tp3: number | null
          tp3_r: number | null
        }
        Insert: {
          atr: number
          c_alignment?: number
          c_rr?: number
          c_symmetry?: number
          c_volatility?: number
          confidence_score: number
          created_at?: string
          detected_at?: string
          direction: Database["public"]["Enums"]["trade_direction"]
          entry_price: number
          ev_prior?: number | null
          expired_at?: string | null
          grade: Database["public"]["Enums"]["signal_grade"]
          h1_bias?: string | null
          h4_bias?: string | null
          id?: string
          instrument: string
          m15_bias?: string | null
          max_acceptable_entry?: number | null
          max_r?: number | null
          model_version?: number
          observation_key?: string | null
          p_fill_prior?: number | null
          p_joint_prior?: number | null
          p_momentum?: number | null
          p_order_block?: number | null
          p_trend?: number | null
          p_volatility_expansion?: number | null
          p_win_prior?: number | null
          pattern_symmetry?: number
          pillars_passed?: number | null
          prior_filled_n?: number | null
          prior_sample_n?: number | null
          prior_tier?: number | null
          qualitative_breakdown?: string
          resolved_outcome?: Database["public"]["Enums"]["trade_outcome"]
          resolved_r_multiple?: number | null
          rr_ratio: number
          status?: string
          stop_loss: number
          structure_key?: string | null
          tp1: number
          tp1_r?: number | null
          tp2: number
          tp2_r?: number | null
          tp3?: number | null
          tp3_r?: number | null
        }
        Update: {
          atr?: number
          c_alignment?: number
          c_rr?: number
          c_symmetry?: number
          c_volatility?: number
          confidence_score?: number
          created_at?: string
          detected_at?: string
          direction?: Database["public"]["Enums"]["trade_direction"]
          entry_price?: number
          ev_prior?: number | null
          expired_at?: string | null
          grade?: Database["public"]["Enums"]["signal_grade"]
          h1_bias?: string | null
          h4_bias?: string | null
          id?: string
          instrument?: string
          m15_bias?: string | null
          max_acceptable_entry?: number | null
          max_r?: number | null
          model_version?: number
          observation_key?: string | null
          p_fill_prior?: number | null
          p_joint_prior?: number | null
          p_momentum?: number | null
          p_order_block?: number | null
          p_trend?: number | null
          p_volatility_expansion?: number | null
          p_win_prior?: number | null
          pattern_symmetry?: number
          pillars_passed?: number | null
          prior_filled_n?: number | null
          prior_sample_n?: number | null
          prior_tier?: number | null
          qualitative_breakdown?: string
          resolved_outcome?: Database["public"]["Enums"]["trade_outcome"]
          resolved_r_multiple?: number | null
          rr_ratio?: number
          status?: string
          stop_loss?: number
          structure_key?: string | null
          tp1?: number
          tp1_r?: number | null
          tp2?: number
          tp2_r?: number | null
          tp3?: number | null
          tp3_r?: number | null
        }
        Relationships: []
      }
      scanner_settings: {
        Row: {
          account_currency: string
          account_equity: number
          alert_min_grade: Database["public"]["Enums"]["signal_grade"]
          created_at: string
          daily_setup_cap: number
          instruments: string[]
          leverage: number
          max_position_size: number
          max_stop_loss_percent: number
          min_grade: Database["public"]["Enums"]["signal_grade"]
          notify_email: boolean
          notify_push: boolean
          order_strategy: string
          risk_per_trade_percent: number
          sessions: string[]
          timeframes: string[]
          updated_at: string
          user_id: string
          webhook_enabled: boolean
          webhook_format: string
          webhook_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          account_currency?: string
          account_equity?: number
          alert_min_grade?: Database["public"]["Enums"]["signal_grade"]
          created_at?: string
          daily_setup_cap?: number
          instruments?: string[]
          leverage?: number
          max_position_size?: number
          max_stop_loss_percent?: number
          min_grade?: Database["public"]["Enums"]["signal_grade"]
          notify_email?: boolean
          notify_push?: boolean
          order_strategy?: string
          risk_per_trade_percent?: number
          sessions?: string[]
          timeframes?: string[]
          updated_at?: string
          user_id: string
          webhook_enabled?: boolean
          webhook_format?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          account_currency?: string
          account_equity?: number
          alert_min_grade?: Database["public"]["Enums"]["signal_grade"]
          created_at?: string
          daily_setup_cap?: number
          instruments?: string[]
          leverage?: number
          max_position_size?: number
          max_stop_loss_percent?: number
          min_grade?: Database["public"]["Enums"]["signal_grade"]
          notify_email?: boolean
          notify_push?: boolean
          order_strategy?: string
          risk_per_trade_percent?: number
          sessions?: string[]
          timeframes?: string[]
          updated_at?: string
          user_id?: string
          webhook_enabled?: boolean
          webhook_format?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      shadow_engine_state: {
        Row: {
          active_replay_version: number
          candidate_capture_enabled: boolean
          candidate_enrolment_enabled: boolean
          candidate_rows_per_run: number
          consecutive_failures: number
          fill_gate_notified_at: string | null
          id: boolean
          last_error: string | null
          last_run_at: string | null
          paused: boolean
          replay_v2_shadow_enabled: boolean
          research_errors: number
          research_last_error: string | null
          research_last_error_at: string | null
          updated_at: string
          v2_enabled: boolean
          v3_enabled: boolean
          win_gate_notified_at: string | null
        }
        Insert: {
          active_replay_version?: number
          candidate_capture_enabled?: boolean
          candidate_enrolment_enabled?: boolean
          candidate_rows_per_run?: number
          consecutive_failures?: number
          fill_gate_notified_at?: string | null
          id?: boolean
          last_error?: string | null
          last_run_at?: string | null
          paused?: boolean
          replay_v2_shadow_enabled?: boolean
          research_errors?: number
          research_last_error?: string | null
          research_last_error_at?: string | null
          updated_at?: string
          v2_enabled?: boolean
          v3_enabled?: boolean
          win_gate_notified_at?: string | null
        }
        Update: {
          active_replay_version?: number
          candidate_capture_enabled?: boolean
          candidate_enrolment_enabled?: boolean
          candidate_rows_per_run?: number
          consecutive_failures?: number
          fill_gate_notified_at?: string | null
          id?: boolean
          last_error?: string | null
          last_run_at?: string | null
          paused?: boolean
          replay_v2_shadow_enabled?: boolean
          research_errors?: number
          research_last_error?: string | null
          research_last_error_at?: string | null
          updated_at?: string
          v2_enabled?: boolean
          v3_enabled?: boolean
          win_gate_notified_at?: string | null
        }
        Relationships: []
      }
      shadow_executions: {
        Row: {
          adjudication: string | null
          ambiguous_bar_target_touch: number | null
          ambiguous_bars: number
          atr: number | null
          bars_replayed: number
          bars_to_outcome: number | null
          cohort: string
          confidence_score: number | null
          created_at: string
          data_quality_outcome: string | null
          detected_at: string
          direction: Database["public"]["Enums"]["trade_direction"]
          entry_price: number
          entry_source: string | null
          error: string | null
          execution_policy: string
          execution_slippage_pips: number | null
          fill_ambiguous_tif: boolean
          fill_bar_excursion_ambiguous: boolean
          fill_bar_time: string | null
          fill_gap_through: boolean
          fill_price: number | null
          filled_at: string | null
          first_target_touched: number | null
          grade: Database["public"]["Enums"]["signal_grade"]
          gross_r: number | null
          id: string
          instrument: string
          last_polled_at: string | null
          max_adverse_excursion_r: number | null
          max_favorable_excursion_r: number | null
          max_r: number | null
          max_target_touched: number | null
          miss_distance_atr: number | null
          ml_target_label: number | null
          model_version: number
          net_r: number | null
          observation_key: string | null
          plan_id: string
          quality_grade: string | null
          realized_r: number | null
          replay_cursor: string | null
          replay_version: number
          research_candidate_id: string | null
          resolved_at: string | null
          resolved_outcome: string | null
          risk_price: number
          risk_price_actual: number | null
          signal_id: string | null
          status: string
          stop_anchor: string | null
          stop_before_tp1: boolean | null
          stop_gap_through: boolean
          stop_loss: number
          strategy_family: string | null
          tp1: number
          tp1_before_stop: boolean | null
          tp1_r: number | null
          tp2: number
          tp2_r: number | null
          tp3: number | null
          tp3_r: number | null
          trading_session: string | null
          updated_at: string
          volatility_index: number | null
        }
        Insert: {
          adjudication?: string | null
          ambiguous_bar_target_touch?: number | null
          ambiguous_bars?: number
          atr?: number | null
          bars_replayed?: number
          bars_to_outcome?: number | null
          cohort?: string
          confidence_score?: number | null
          created_at?: string
          data_quality_outcome?: string | null
          detected_at: string
          direction: Database["public"]["Enums"]["trade_direction"]
          entry_price: number
          entry_source?: string | null
          error?: string | null
          execution_policy?: string
          execution_slippage_pips?: number | null
          fill_ambiguous_tif?: boolean
          fill_bar_excursion_ambiguous?: boolean
          fill_bar_time?: string | null
          fill_gap_through?: boolean
          fill_price?: number | null
          filled_at?: string | null
          first_target_touched?: number | null
          grade: Database["public"]["Enums"]["signal_grade"]
          gross_r?: number | null
          id?: string
          instrument: string
          last_polled_at?: string | null
          max_adverse_excursion_r?: number | null
          max_favorable_excursion_r?: number | null
          max_r?: number | null
          max_target_touched?: number | null
          miss_distance_atr?: number | null
          ml_target_label?: number | null
          model_version?: number
          net_r?: number | null
          observation_key?: string | null
          plan_id?: string
          quality_grade?: string | null
          realized_r?: number | null
          replay_cursor?: string | null
          replay_version?: number
          research_candidate_id?: string | null
          resolved_at?: string | null
          resolved_outcome?: string | null
          risk_price: number
          risk_price_actual?: number | null
          signal_id?: string | null
          status?: string
          stop_anchor?: string | null
          stop_before_tp1?: boolean | null
          stop_gap_through?: boolean
          stop_loss: number
          strategy_family?: string | null
          tp1: number
          tp1_before_stop?: boolean | null
          tp1_r?: number | null
          tp2: number
          tp2_r?: number | null
          tp3?: number | null
          tp3_r?: number | null
          trading_session?: string | null
          updated_at?: string
          volatility_index?: number | null
        }
        Update: {
          adjudication?: string | null
          ambiguous_bar_target_touch?: number | null
          ambiguous_bars?: number
          atr?: number | null
          bars_replayed?: number
          bars_to_outcome?: number | null
          cohort?: string
          confidence_score?: number | null
          created_at?: string
          data_quality_outcome?: string | null
          detected_at?: string
          direction?: Database["public"]["Enums"]["trade_direction"]
          entry_price?: number
          entry_source?: string | null
          error?: string | null
          execution_policy?: string
          execution_slippage_pips?: number | null
          fill_ambiguous_tif?: boolean
          fill_bar_excursion_ambiguous?: boolean
          fill_bar_time?: string | null
          fill_gap_through?: boolean
          fill_price?: number | null
          filled_at?: string | null
          first_target_touched?: number | null
          grade?: Database["public"]["Enums"]["signal_grade"]
          gross_r?: number | null
          id?: string
          instrument?: string
          last_polled_at?: string | null
          max_adverse_excursion_r?: number | null
          max_favorable_excursion_r?: number | null
          max_r?: number | null
          max_target_touched?: number | null
          miss_distance_atr?: number | null
          ml_target_label?: number | null
          model_version?: number
          net_r?: number | null
          observation_key?: string | null
          plan_id?: string
          quality_grade?: string | null
          realized_r?: number | null
          replay_cursor?: string | null
          replay_version?: number
          research_candidate_id?: string | null
          resolved_at?: string | null
          resolved_outcome?: string | null
          risk_price?: number
          risk_price_actual?: number | null
          signal_id?: string | null
          status?: string
          stop_anchor?: string | null
          stop_before_tp1?: boolean | null
          stop_gap_through?: boolean
          stop_loss?: number
          strategy_family?: string | null
          tp1?: number
          tp1_before_stop?: boolean | null
          tp1_r?: number | null
          tp2?: number
          tp2_r?: number | null
          tp3?: number | null
          tp3_r?: number | null
          trading_session?: string | null
          updated_at?: string
          volatility_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shadow_executions_research_candidate_id_fkey"
            columns: ["research_candidate_id"]
            isOneToOne: false
            referencedRelation: "research_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadow_executions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_queue: {
        Row: {
          attempts: number
          enqueued_at: string
          error: string | null
          finished_at: string | null
          id: number
          result: string | null
          signal_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          error?: string | null
          finished_at?: string | null
          id?: number
          result?: string | null
          signal_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          error?: string | null
          finished_at?: string | null
          id?: number
          result?: string | null
          signal_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shadow_queue_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_user_telemetry: {
        Row: {
          created_at: string
          event: string
          id: string
          signal_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          signal_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          signal_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_user_telemetry_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      v2_structure_claims: {
        Row: {
          claimed_at: string
          model_version: number
          structure_key: string
        }
        Insert: {
          claimed_at?: string
          model_version: number
          structure_key: string
        }
        Update: {
          claimed_at?: string
          model_version?: number
          structure_key?: string
        }
        Relationships: []
      }
      verify_reminder_log: {
        Row: {
          iso_week: string
          missing_count: number
          sent_at: string
          user_id: string
        }
        Insert: {
          iso_week: string
          missing_count?: number
          sent_at?: string
          user_id: string
        }
        Update: {
          iso_week?: string
          missing_count?: number
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vol_definitions: {
        Row: {
          active: boolean
          created_at: string
          definition_version: number
          id: string
          instrument: string
          model_version: number
          source: string
          t1: number
          t2: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          definition_version?: number
          id?: string
          instrument: string
          model_version: number
          source?: string
          t1: number
          t2: number
        }
        Update: {
          active?: boolean
          created_at?: string
          definition_version?: number
          id?: string
          instrument?: string
          model_version?: number
          source?: string
          t1?: number
          t2?: number
        }
        Relationships: []
      }
      webhook_dispatch_log: {
        Row: {
          created_at: string
          endpoint_url: string | null
          error: string | null
          http_status: number | null
          id: string
          latency_ms: number | null
          signal_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          endpoint_url?: string | null
          error?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          signal_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          endpoint_url?: string | null
          error?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          signal_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      weekly_report_log: {
        Row: {
          iso_week: string
          sent_at: string
        }
        Insert: {
          iso_week: string
          sent_at?: string
        }
        Update: {
          iso_week?: string
          sent_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      shadow_executions_production: {
        Row: {
          adjudication: string | null
          ambiguous_bar_target_touch: number | null
          ambiguous_bars: number | null
          atr: number | null
          bars_replayed: number | null
          bars_to_outcome: number | null
          cohort: string | null
          confidence_score: number | null
          created_at: string | null
          data_quality_outcome: string | null
          detected_at: string | null
          direction: Database["public"]["Enums"]["trade_direction"] | null
          entry_price: number | null
          entry_source: string | null
          error: string | null
          execution_policy: string | null
          execution_slippage_pips: number | null
          fill_ambiguous_tif: boolean | null
          fill_bar_excursion_ambiguous: boolean | null
          fill_bar_time: string | null
          fill_gap_through: boolean | null
          fill_price: number | null
          filled_at: string | null
          first_target_touched: number | null
          grade: Database["public"]["Enums"]["signal_grade"] | null
          gross_r: number | null
          id: string | null
          instrument: string | null
          last_polled_at: string | null
          max_adverse_excursion_r: number | null
          max_favorable_excursion_r: number | null
          max_r: number | null
          max_target_touched: number | null
          miss_distance_atr: number | null
          ml_target_label: number | null
          model_version: number | null
          net_r: number | null
          observation_key: string | null
          plan_id: string | null
          quality_grade: string | null
          realized_r: number | null
          replay_cursor: string | null
          replay_version: number | null
          resolved_at: string | null
          resolved_outcome: string | null
          risk_price: number | null
          risk_price_actual: number | null
          signal_id: string | null
          status: string | null
          stop_anchor: string | null
          stop_before_tp1: boolean | null
          stop_gap_through: boolean | null
          stop_loss: number | null
          strategy_family: string | null
          tp1: number | null
          tp1_before_stop: boolean | null
          tp1_r: number | null
          tp2: number | null
          tp2_r: number | null
          tp3: number | null
          tp3_r: number | null
          trading_session: string | null
          updated_at: string | null
          volatility_index: number | null
        }
        Insert: {
          adjudication?: string | null
          ambiguous_bar_target_touch?: number | null
          ambiguous_bars?: number | null
          atr?: number | null
          bars_replayed?: number | null
          bars_to_outcome?: number | null
          cohort?: string | null
          confidence_score?: number | null
          created_at?: string | null
          data_quality_outcome?: string | null
          detected_at?: string | null
          direction?: Database["public"]["Enums"]["trade_direction"] | null
          entry_price?: number | null
          entry_source?: string | null
          error?: string | null
          execution_policy?: string | null
          execution_slippage_pips?: number | null
          fill_ambiguous_tif?: boolean | null
          fill_bar_excursion_ambiguous?: boolean | null
          fill_bar_time?: string | null
          fill_gap_through?: boolean | null
          fill_price?: number | null
          filled_at?: string | null
          first_target_touched?: number | null
          grade?: Database["public"]["Enums"]["signal_grade"] | null
          gross_r?: number | null
          id?: string | null
          instrument?: string | null
          last_polled_at?: string | null
          max_adverse_excursion_r?: number | null
          max_favorable_excursion_r?: number | null
          max_r?: number | null
          max_target_touched?: number | null
          miss_distance_atr?: number | null
          ml_target_label?: number | null
          model_version?: number | null
          net_r?: number | null
          observation_key?: string | null
          plan_id?: string | null
          quality_grade?: string | null
          realized_r?: number | null
          replay_cursor?: string | null
          replay_version?: number | null
          resolved_at?: string | null
          resolved_outcome?: string | null
          risk_price?: number | null
          risk_price_actual?: number | null
          signal_id?: string | null
          status?: string | null
          stop_anchor?: string | null
          stop_before_tp1?: boolean | null
          stop_gap_through?: boolean | null
          stop_loss?: number | null
          strategy_family?: string | null
          tp1?: number | null
          tp1_before_stop?: boolean | null
          tp1_r?: number | null
          tp2?: number | null
          tp2_r?: number | null
          tp3?: number | null
          tp3_r?: number | null
          trading_session?: string | null
          updated_at?: string | null
          volatility_index?: number | null
        }
        Update: {
          adjudication?: string | null
          ambiguous_bar_target_touch?: number | null
          ambiguous_bars?: number | null
          atr?: number | null
          bars_replayed?: number | null
          bars_to_outcome?: number | null
          cohort?: string | null
          confidence_score?: number | null
          created_at?: string | null
          data_quality_outcome?: string | null
          detected_at?: string | null
          direction?: Database["public"]["Enums"]["trade_direction"] | null
          entry_price?: number | null
          entry_source?: string | null
          error?: string | null
          execution_policy?: string | null
          execution_slippage_pips?: number | null
          fill_ambiguous_tif?: boolean | null
          fill_bar_excursion_ambiguous?: boolean | null
          fill_bar_time?: string | null
          fill_gap_through?: boolean | null
          fill_price?: number | null
          filled_at?: string | null
          first_target_touched?: number | null
          grade?: Database["public"]["Enums"]["signal_grade"] | null
          gross_r?: number | null
          id?: string | null
          instrument?: string | null
          last_polled_at?: string | null
          max_adverse_excursion_r?: number | null
          max_favorable_excursion_r?: number | null
          max_r?: number | null
          max_target_touched?: number | null
          miss_distance_atr?: number | null
          ml_target_label?: number | null
          model_version?: number | null
          net_r?: number | null
          observation_key?: string | null
          plan_id?: string | null
          quality_grade?: string | null
          realized_r?: number | null
          replay_cursor?: string | null
          replay_version?: number | null
          resolved_at?: string | null
          resolved_outcome?: string | null
          risk_price?: number | null
          risk_price_actual?: number | null
          signal_id?: string | null
          status?: string | null
          stop_anchor?: string | null
          stop_before_tp1?: boolean | null
          stop_gap_through?: boolean | null
          stop_loss?: number | null
          strategy_family?: string | null
          tp1?: number | null
          tp1_before_stop?: boolean | null
          tp1_r?: number | null
          tp2?: number | null
          tp2_r?: number | null
          tp3?: number | null
          tp3_r?: number | null
          trading_session?: string | null
          updated_at?: string | null
          volatility_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shadow_executions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      claim_learning_milestone: { Args: { _gate: string }; Returns: boolean }
      claim_scan_job: {
        Args: never
        Returns: {
          enqueued_at: string
          id: number
          instrument: string
          run_id: string
        }[]
      }
      claim_shadow_job: {
        Args: never
        Returns: {
          id: number
          signal_id: string
        }[]
      }
      claim_v2_structure: {
        Args: {
          _cooldown_minutes?: number
          _model_version: number
          _structure_key: string
        }
        Returns: boolean
      }
      claim_verify_reminder: {
        Args: { _missing: number; _user_id: string; _week: string }
        Returns: boolean
      }
      claim_weekly_report: { Args: { _week: string }; Returns: boolean }
      get_admin_author_split: { Args: never; Returns: Json }
      get_admin_candidate_funnel: { Args: never; Returns: Json }
      get_admin_filter_lift: { Args: never; Returns: Json }
      get_admin_intelligence: { Args: never; Returns: Json }
      get_admin_payoff_research: { Args: never; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      maintain_scan_queue: { Args: never; Returns: Json }
      maintain_shadow_queue: { Args: never; Returns: Json }
      prune_v2_structure_claims: { Args: never; Returns: number }
      purge_expired_signals: { Args: never; Returns: number }
      recompute_filter_lift: {
        Args: { _horizon_hours?: number }
        Returns: Json
      }
      recompute_payoff_stats: {
        Args: {
          _execution_policy?: string
          _horizon_hours?: number
          _model_version?: number
          _replay_version?: number
        }
        Returns: Json
      }
      recompute_regime_stats: {
        Args: { _model_version?: number }
        Returns: Json
      }
      release_learning_milestone: {
        Args: { _gate: string }
        Returns: undefined
      }
      release_verify_reminder: {
        Args: { _user_id: string; _week: string }
        Returns: undefined
      }
      release_weekly_report: { Args: { _week: string }; Returns: undefined }
    }
    Enums: {
      decision_kind: "taken" | "skipped"
      signal_grade: "A" | "B" | "C" | "A+"
      tf_code: "H4" | "H1" | "M15"
      trade_direction: "long" | "short"
      trade_outcome: "win" | "loss" | "breakeven" | "open"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      decision_kind: ["taken", "skipped"],
      signal_grade: ["A", "B", "C", "A+"],
      tf_code: ["H4", "H1", "M15"],
      trade_direction: ["long", "short"],
      trade_outcome: ["win", "loss", "breakeven", "open"],
    },
  },
} as const
