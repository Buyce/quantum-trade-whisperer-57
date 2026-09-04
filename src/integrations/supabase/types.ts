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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_quota_defaults: {
        Row: {
          id: boolean
          max_demo: number
          max_live: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          max_demo?: number
          max_live?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          max_demo?: number
          max_live?: number
          updated_at?: string
        }
        Relationships: []
      }
      account_quota_overrides: {
        Row: {
          created_at: string
          max_demo: number | null
          max_live: number | null
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          max_demo?: number | null
          max_live?: number | null
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          max_demo?: number | null
          max_live?: number | null
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      account_risk_events: {
        Row: {
          absolute_drawdown: number | null
          account_id: string
          event_at: string
          exceeded_threshold_type: string | null
          fingerprint: string
          id: number
          payload: Json
          recorded_at: string
          relative_drawdown: number | null
          tracker_id: string
          user_id: string
        }
        Insert: {
          absolute_drawdown?: number | null
          account_id: string
          event_at: string
          exceeded_threshold_type?: string | null
          fingerprint: string
          id?: number
          payload?: Json
          recorded_at?: string
          relative_drawdown?: number | null
          tracker_id: string
          user_id: string
        }
        Update: {
          absolute_drawdown?: number | null
          account_id?: string
          event_at?: string
          exceeded_threshold_type?: string | null
          fingerprint?: string
          id?: number
          payload?: Json
          recorded_at?: string
          relative_drawdown?: number | null
          tracker_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_risk_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_risk_events_tracker_id_fkey"
            columns: ["tracker_id"]
            isOneToOne: false
            referencedRelation: "account_risk_trackers"
            referencedColumns: ["id"]
          },
        ]
      }
      account_risk_trackers: {
        Row: {
          account_id: string
          created_at: string
          id: string
          last_error: string | null
          name: string
          period: string
          supported: boolean
          threshold_kind: string
          threshold_value: number
          unsupported_reason: string | null
          updated_at: string
          user_id: string
          vendor_tracker_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          name: string
          period: string
          supported?: boolean
          threshold_kind: string
          threshold_value: number
          unsupported_reason?: string | null
          updated_at?: string
          user_id: string
          vendor_tracker_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          name?: string
          period?: string
          supported?: boolean
          threshold_kind?: string
          threshold_value?: number
          unsupported_reason?: string | null
          updated_at?: string
          user_id?: string
          vendor_tracker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_risk_trackers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_telemetry_snapshots: {
        Row: {
          account_id: string
          id: number
          metrics: Json
          observed_at: string
          reason: string | null
          retry_after_seconds: number | null
          source: string
          status: string
          user_id: string
        }
        Insert: {
          account_id: string
          id?: number
          metrics?: Json
          observed_at?: string
          reason?: string | null
          retry_after_seconds?: number | null
          source?: string
          status: string
          user_id: string
        }
        Update: {
          account_id?: string
          id?: number
          metrics?: Json
          observed_at?: string
          reason?: string | null
          retry_after_seconds?: number | null
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_telemetry_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
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
      benchmark_policy: {
        Row: {
          benchmark_account_id: string | null
          daily_order_cap: number | null
          dry_run: boolean
          enabled: boolean
          id: boolean
          instruments: string[]
          max_concurrent_risk: number | null
          min_grade: string
          note: string | null
          policy_version: number
          risk_percent: number | null
          updated_at: string
        }
        Insert: {
          benchmark_account_id?: string | null
          daily_order_cap?: number | null
          dry_run?: boolean
          enabled?: boolean
          id?: boolean
          instruments?: string[]
          max_concurrent_risk?: number | null
          min_grade?: string
          note?: string | null
          policy_version?: number
          risk_percent?: number | null
          updated_at?: string
        }
        Update: {
          benchmark_account_id?: string | null
          daily_order_cap?: number | null
          dry_run?: boolean
          enabled?: boolean
          id?: boolean
          instruments?: string[]
          max_concurrent_risk?: number | null
          min_grade?: string
          note?: string | null
          policy_version?: number
          risk_percent?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_policy_benchmark_account_id_fkey"
            columns: ["benchmark_account_id"]
            isOneToOne: false
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_order_associations: {
        Row: {
          account_mode: string | null
          broker_order_id: string | null
          broker_symbol: string | null
          client_id: string | null
          connected_account_id: string | null
          created_at: string
          delivery_id: number
          destination_type: string | null
          id: string
          magic: number | null
          signal_id: string | null
          submitted_at: string | null
          submitted_entry: number | null
          submitted_stop: number | null
          submitted_target: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_mode?: string | null
          broker_order_id?: string | null
          broker_symbol?: string | null
          client_id?: string | null
          connected_account_id?: string | null
          created_at?: string
          delivery_id: number
          destination_type?: string | null
          id?: string
          magic?: number | null
          signal_id?: string | null
          submitted_at?: string | null
          submitted_entry?: number | null
          submitted_stop?: number | null
          submitted_target?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_mode?: string | null
          broker_order_id?: string | null
          broker_symbol?: string | null
          client_id?: string | null
          connected_account_id?: string | null
          created_at?: string
          delivery_id?: number
          destination_type?: string | null
          id?: string
          magic?: number | null
          signal_id?: string | null
          submitted_at?: string | null
          submitted_entry?: number | null
          submitted_stop?: number | null
          submitted_target?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      broker_symbol_specs: {
        Row: {
          base_currency: string | null
          calc_mode: string | null
          contract_size: number | null
          digits: number | null
          fetched_at: string
          freeze_level: number | null
          margin_currency: string | null
          point: number | null
          point_source: string | null
          profit_currency: string | null
          provider_symbol: string | null
          raw: Json | null
          source: string
          stops_level: number | null
          symbol: string
          tick_size: number | null
          tick_value: number | null
          trade_mode: string | null
          volume_limit: number | null
          volume_max: number | null
          volume_min: number | null
          volume_step: number | null
        }
        Insert: {
          base_currency?: string | null
          calc_mode?: string | null
          contract_size?: number | null
          digits?: number | null
          fetched_at?: string
          freeze_level?: number | null
          margin_currency?: string | null
          point?: number | null
          point_source?: string | null
          profit_currency?: string | null
          provider_symbol?: string | null
          raw?: Json | null
          source?: string
          stops_level?: number | null
          symbol: string
          tick_size?: number | null
          tick_value?: number | null
          trade_mode?: string | null
          volume_limit?: number | null
          volume_max?: number | null
          volume_min?: number | null
          volume_step?: number | null
        }
        Update: {
          base_currency?: string | null
          calc_mode?: string | null
          contract_size?: number | null
          digits?: number | null
          fetched_at?: string
          freeze_level?: number | null
          margin_currency?: string | null
          point?: number | null
          point_source?: string | null
          profit_currency?: string | null
          provider_symbol?: string | null
          raw?: Json | null
          source?: string
          stops_level?: number | null
          symbol?: string
          tick_size?: number | null
          tick_value?: number | null
          trade_mode?: string | null
          volume_limit?: number | null
          volume_max?: number | null
          volume_min?: number | null
          volume_step?: number | null
        }
        Relationships: []
      }
      broker_trade_evidence: {
        Row: {
          account_id: string | null
          actual_initial_stop: number | null
          association_basis: string
          broker_account_type: string | null
          broker_order_id: string | null
          broker_position_id: string | null
          broker_symbol: string
          client_id: string | null
          commission: number | null
          deals: Json
          delivery_id: number | null
          direction: string | null
          entry_at: string | null
          entry_price: number | null
          evidence_class: string
          evidence_phase: string
          exit_at: string | null
          exit_price: number | null
          first_observed_at: string
          gross_profit: number | null
          id: string
          last_reconciled_at: string | null
          magic: number | null
          metaapi_account_id: string | null
          news_context: string
          planned_entry: number | null
          planned_stop: number | null
          planned_target: number | null
          profit_currency: string | null
          published_entry: number | null
          r_availability: string | null
          r_math_version: number | null
          r_vs_actual_risk: number | null
          r_vs_plan: number | null
          research_account_ref: string | null
          research_consent: boolean
          resolved_at: string | null
          signal_day_of_week: number | null
          signal_detected_at: string | null
          signal_first_decision_at: string | null
          signal_grade: string | null
          signal_grade_source: string | null
          signal_id: string | null
          signal_instrument: string | null
          signal_ref: string | null
          signal_time_of_day: number | null
          signal_trading_session: string | null
          slippage_availability: string | null
          slippage_basis: string | null
          slippage_price: number | null
          state: string
          stop_provenance: string | null
          stop_source: string | null
          swap: number | null
          updated_at: string
          user_id: string | null
          volume: number | null
        }
        Insert: {
          account_id?: string | null
          actual_initial_stop?: number | null
          association_basis: string
          broker_account_type?: string | null
          broker_order_id?: string | null
          broker_position_id?: string | null
          broker_symbol: string
          client_id?: string | null
          commission?: number | null
          deals?: Json
          delivery_id?: number | null
          direction?: string | null
          entry_at?: string | null
          entry_price?: number | null
          evidence_class: string
          evidence_phase?: string
          exit_at?: string | null
          exit_price?: number | null
          first_observed_at?: string
          gross_profit?: number | null
          id?: string
          last_reconciled_at?: string | null
          magic?: number | null
          metaapi_account_id?: string | null
          news_context?: string
          planned_entry?: number | null
          planned_stop?: number | null
          planned_target?: number | null
          profit_currency?: string | null
          published_entry?: number | null
          r_availability?: string | null
          r_math_version?: number | null
          r_vs_actual_risk?: number | null
          r_vs_plan?: number | null
          research_account_ref?: string | null
          research_consent?: boolean
          resolved_at?: string | null
          signal_day_of_week?: number | null
          signal_detected_at?: string | null
          signal_first_decision_at?: string | null
          signal_grade?: string | null
          signal_grade_source?: string | null
          signal_id?: string | null
          signal_instrument?: string | null
          signal_ref?: string | null
          signal_time_of_day?: number | null
          signal_trading_session?: string | null
          slippage_availability?: string | null
          slippage_basis?: string | null
          slippage_price?: number | null
          state?: string
          stop_provenance?: string | null
          stop_source?: string | null
          swap?: number | null
          updated_at?: string
          user_id?: string | null
          volume?: number | null
        }
        Update: {
          account_id?: string | null
          actual_initial_stop?: number | null
          association_basis?: string
          broker_account_type?: string | null
          broker_order_id?: string | null
          broker_position_id?: string | null
          broker_symbol?: string
          client_id?: string | null
          commission?: number | null
          deals?: Json
          delivery_id?: number | null
          direction?: string | null
          entry_at?: string | null
          entry_price?: number | null
          evidence_class?: string
          evidence_phase?: string
          exit_at?: string | null
          exit_price?: number | null
          first_observed_at?: string
          gross_profit?: number | null
          id?: string
          last_reconciled_at?: string | null
          magic?: number | null
          metaapi_account_id?: string | null
          news_context?: string
          planned_entry?: number | null
          planned_stop?: number | null
          planned_target?: number | null
          profit_currency?: string | null
          published_entry?: number | null
          r_availability?: string | null
          r_math_version?: number | null
          r_vs_actual_risk?: number | null
          r_vs_plan?: number | null
          research_account_ref?: string | null
          research_consent?: boolean
          resolved_at?: string | null
          signal_day_of_week?: number | null
          signal_detected_at?: string | null
          signal_first_decision_at?: string | null
          signal_grade?: string | null
          signal_grade_source?: string | null
          signal_id?: string | null
          signal_instrument?: string | null
          signal_ref?: string | null
          signal_time_of_day?: number | null
          signal_trading_session?: string | null
          slippage_availability?: string | null
          slippage_basis?: string | null
          slippage_price?: number | null
          state?: string
          stop_provenance?: string | null
          stop_source?: string | null
          swap?: number | null
          updated_at?: string
          user_id?: string | null
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "broker_trade_evidence_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_trade_evidence_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "execution_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_trade_evidence_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      candle_policies: {
        Row: {
          applies_to: string
          created_at: string
          description: string
          finality: string
          name: string
          version: number
        }
        Insert: {
          applies_to: string
          created_at?: string
          description: string
          finality: string
          name: string
          version: number
        }
        Update: {
          applies_to?: string
          created_at?: string
          description?: string
          finality?: string
          name?: string
          version?: number
        }
        Relationships: []
      }
      connected_account_features: {
        Row: {
          account_id: string
          metastats_api_enabled: boolean
          mt5_netting: boolean
          observed_at: string
          reliability: string | null
          risk_guardian_available: boolean
          risk_guardian_reason: string | null
          risk_management_api_enabled: boolean
          user_id: string
        }
        Insert: {
          account_id: string
          metastats_api_enabled?: boolean
          mt5_netting?: boolean
          observed_at?: string
          reliability?: string | null
          risk_guardian_available?: boolean
          risk_guardian_reason?: string | null
          risk_management_api_enabled?: boolean
          user_id: string
        }
        Update: {
          account_id?: string
          metastats_api_enabled?: boolean
          mt5_netting?: boolean
          observed_at?: string
          reliability?: string | null
          risk_guardian_available?: boolean
          risk_guardian_reason?: string | null
          risk_management_api_enabled?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connected_account_features_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_account_specs: {
        Row: {
          account_id: string
          base_currency: string | null
          broker_symbol: string
          calc_mode: string | null
          canonical_symbol: string | null
          contract_size: number | null
          digits: number | null
          fetched_at: string
          freeze_level: number | null
          id: string
          margin_currency: string | null
          point: number | null
          point_source: string | null
          profit_currency: string | null
          raw: Json | null
          stops_level: number | null
          tick_size: number | null
          tick_value: number | null
          trade_mode: string | null
          user_id: string
          volume_limit: number | null
          volume_max: number | null
          volume_min: number | null
          volume_step: number | null
        }
        Insert: {
          account_id: string
          base_currency?: string | null
          broker_symbol: string
          calc_mode?: string | null
          canonical_symbol?: string | null
          contract_size?: number | null
          digits?: number | null
          fetched_at?: string
          freeze_level?: number | null
          id?: string
          margin_currency?: string | null
          point?: number | null
          point_source?: string | null
          profit_currency?: string | null
          raw?: Json | null
          stops_level?: number | null
          tick_size?: number | null
          tick_value?: number | null
          trade_mode?: string | null
          user_id: string
          volume_limit?: number | null
          volume_max?: number | null
          volume_min?: number | null
          volume_step?: number | null
        }
        Update: {
          account_id?: string
          base_currency?: string | null
          broker_symbol?: string
          calc_mode?: string | null
          canonical_symbol?: string | null
          contract_size?: number | null
          digits?: number | null
          fetched_at?: string
          freeze_level?: number | null
          id?: string
          margin_currency?: string | null
          point?: number | null
          point_source?: string | null
          profit_currency?: string | null
          raw?: Json | null
          stops_level?: number | null
          tick_size?: number | null
          tick_value?: number | null
          trade_mode?: string | null
          user_id?: string
          volume_limit?: number | null
          volume_max?: number | null
          volume_min?: number | null
          volume_step?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "connected_account_specs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_account_symbols: {
        Row: {
          account_id: string
          broker_symbol: string | null
          candidates: string[]
          canonical_symbol: string
          id: string
          mapping_kind: string
          resolved_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          broker_symbol?: string | null
          candidates?: string[]
          canonical_symbol: string
          id?: string
          mapping_kind: string
          resolved_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          broker_symbol?: string | null
          candidates?: string[]
          canonical_symbol?: string
          id?: string
          mapping_kind?: string
          resolved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connected_account_symbols_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_trading_accounts: {
        Row: {
          account_currency: string | null
          broker_account_type: string
          broker_balance: number | null
          broker_equity: number | null
          broker_free_margin: number | null
          broker_login_masked: string | null
          broker_margin_level: number | null
          broker_name: string | null
          broker_observed_at: string | null
          broker_server: string | null
          connection_status: string | null
          created_at: string
          credentials_configured: boolean
          disconnected_at: string | null
          id: string
          intent: string
          intent_conflict: boolean
          intent_conflict_reason: string | null
          investor_mode: boolean | null
          is_benchmark: boolean
          label: string
          last_error: string | null
          last_reconciled_at: string | null
          leverage: number | null
          magic: number | null
          margin_mode: string | null
          max_account_exposure_note: string | null
          max_account_open_positions: number | null
          metaapi_account_id: string | null
          mode: string
          mode_armed_at: string | null
          mode_armed_config_version: number | null
          phase: string
          platform: string
          provision_transaction_id: string
          provisioning_state: string | null
          reconciliation_last_error: string | null
          reconciliation_last_error_at: string | null
          reconciliation_last_success_at: string | null
          region: string
          research_account_ref: string | null
          research_consent: boolean
          research_consent_at: string | null
          research_consent_version: number | null
          stand_down_reason: string | null
          trade_allowed: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_currency?: string | null
          broker_account_type?: string
          broker_balance?: number | null
          broker_equity?: number | null
          broker_free_margin?: number | null
          broker_login_masked?: string | null
          broker_margin_level?: number | null
          broker_name?: string | null
          broker_observed_at?: string | null
          broker_server?: string | null
          connection_status?: string | null
          created_at?: string
          credentials_configured?: boolean
          disconnected_at?: string | null
          id?: string
          intent: string
          intent_conflict?: boolean
          intent_conflict_reason?: string | null
          investor_mode?: boolean | null
          is_benchmark?: boolean
          label: string
          last_error?: string | null
          last_reconciled_at?: string | null
          leverage?: number | null
          magic?: number | null
          margin_mode?: string | null
          max_account_exposure_note?: string | null
          max_account_open_positions?: number | null
          metaapi_account_id?: string | null
          mode?: string
          mode_armed_at?: string | null
          mode_armed_config_version?: number | null
          phase?: string
          platform: string
          provision_transaction_id: string
          provisioning_state?: string | null
          reconciliation_last_error?: string | null
          reconciliation_last_error_at?: string | null
          reconciliation_last_success_at?: string | null
          region: string
          research_account_ref?: string | null
          research_consent?: boolean
          research_consent_at?: string | null
          research_consent_version?: number | null
          stand_down_reason?: string | null
          trade_allowed?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_currency?: string | null
          broker_account_type?: string
          broker_balance?: number | null
          broker_equity?: number | null
          broker_free_margin?: number | null
          broker_login_masked?: string | null
          broker_margin_level?: number | null
          broker_name?: string | null
          broker_observed_at?: string | null
          broker_server?: string | null
          connection_status?: string | null
          created_at?: string
          credentials_configured?: boolean
          disconnected_at?: string | null
          id?: string
          intent?: string
          intent_conflict?: boolean
          intent_conflict_reason?: string | null
          investor_mode?: boolean | null
          is_benchmark?: boolean
          label?: string
          last_error?: string | null
          last_reconciled_at?: string | null
          leverage?: number | null
          magic?: number | null
          margin_mode?: string | null
          max_account_exposure_note?: string | null
          max_account_open_positions?: number | null
          metaapi_account_id?: string | null
          mode?: string
          mode_armed_at?: string | null
          mode_armed_config_version?: number | null
          phase?: string
          platform?: string
          provision_transaction_id?: string
          provisioning_state?: string | null
          reconciliation_last_error?: string | null
          reconciliation_last_error_at?: string | null
          reconciliation_last_success_at?: string | null
          region?: string
          research_account_ref?: string | null
          research_consent?: boolean
          research_consent_at?: string | null
          research_consent_version?: number | null
          stand_down_reason?: string | null
          trade_allowed?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      economic_event_revisions: {
        Row: {
          actual_published_at: string | null
          actual_value: number | null
          change_kind: string
          created_at: string
          diagnostics: Json
          event_id: string
          event_status: string
          forecast_value: number | null
          id: number
          mapping_version: string
          observed_at: string
          payload_checksum: string
          previous_value: number | null
          provider_updated_at: string | null
          revision: number
          scheduled_at: string | null
          scheduled_date: string | null
          source_version: string
          timestamp_precision: string
        }
        Insert: {
          actual_published_at?: string | null
          actual_value?: number | null
          change_kind: string
          created_at?: string
          diagnostics?: Json
          event_id: string
          event_status: string
          forecast_value?: number | null
          id?: number
          mapping_version: string
          observed_at?: string
          payload_checksum: string
          previous_value?: number | null
          provider_updated_at?: string | null
          revision: number
          scheduled_at?: string | null
          scheduled_date?: string | null
          source_version: string
          timestamp_precision: string
        }
        Update: {
          actual_published_at?: string | null
          actual_value?: number | null
          change_kind?: string
          created_at?: string
          diagnostics?: Json
          event_id?: string
          event_status?: string
          forecast_value?: number | null
          id?: number
          mapping_version?: string
          observed_at?: string
          payload_checksum?: string
          previous_value?: number | null
          provider_updated_at?: string | null
          revision?: number
          scheduled_at?: string | null
          scheduled_date?: string | null
          source_version?: string
          timestamp_precision?: string
        }
        Relationships: [
          {
            foreignKeyName: "economic_event_revisions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "economic_events"
            referencedColumns: ["id"]
          },
        ]
      }
      economic_events: {
        Row: {
          actual_published_at: string | null
          actual_value: number | null
          affected_correlation_groups: string[]
          affected_instruments: string[]
          canonical_event_id: string
          countries: string[]
          created_at: string
          currencies: string[]
          diagnostics: Json
          event_family: string
          event_status: string
          field_provenance: Json
          forecast_value: number | null
          id: string
          importance: string
          ingested_at: string
          mapping_version: string
          original_scheduled_at: string | null
          payload_checksum: string
          previous_value: number | null
          provider: string
          provider_event_key: string
          provider_updated_at: string | null
          revision: number
          scheduled_at: string | null
          scheduled_date: string | null
          source_version: string
          timestamp_precision: string
          units: string | null
          updated_at: string
        }
        Insert: {
          actual_published_at?: string | null
          actual_value?: number | null
          affected_correlation_groups?: string[]
          affected_instruments?: string[]
          canonical_event_id: string
          countries?: string[]
          created_at?: string
          currencies?: string[]
          diagnostics?: Json
          event_family: string
          event_status?: string
          field_provenance?: Json
          forecast_value?: number | null
          id?: string
          importance?: string
          ingested_at?: string
          mapping_version: string
          original_scheduled_at?: string | null
          payload_checksum: string
          previous_value?: number | null
          provider: string
          provider_event_key: string
          provider_updated_at?: string | null
          revision?: number
          scheduled_at?: string | null
          scheduled_date?: string | null
          source_version: string
          timestamp_precision?: string
          units?: string | null
          updated_at?: string
        }
        Update: {
          actual_published_at?: string | null
          actual_value?: number | null
          affected_correlation_groups?: string[]
          affected_instruments?: string[]
          canonical_event_id?: string
          countries?: string[]
          created_at?: string
          currencies?: string[]
          diagnostics?: Json
          event_family?: string
          event_status?: string
          field_provenance?: Json
          forecast_value?: number | null
          id?: string
          importance?: string
          ingested_at?: string
          mapping_version?: string
          original_scheduled_at?: string | null
          payload_checksum?: string
          previous_value?: number | null
          provider?: string
          provider_event_key?: string
          provider_updated_at?: string | null
          revision?: number
          scheduled_at?: string | null
          scheduled_date?: string | null
          source_version?: string
          timestamp_precision?: string
          units?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      executed_trades: {
        Row: {
          actual_entry_at: string | null
          actual_entry_price: number | null
          actual_exit_at: string | null
          actual_exit_price: number | null
          actual_initial_stop: number | null
          broker_ticket: string | null
          commission: number | null
          cost_currency: string | null
          cost_unit: string | null
          created_at: string
          decision_source: string
          decision_source_client: string | null
          derived_r: number | null
          id: string
          net_r: number | null
          notes: string | null
          outcome: Database["public"]["Enums"]["trade_outcome"]
          partial_exits: Json | null
          planned_direction: string | null
          planned_entry: number | null
          planned_stop: number | null
          price_recorded_at: string | null
          price_source: string | null
          price_source_client: string | null
          r_availability: string | null
          r_math_version: number | null
          r_vs_actual_risk: number | null
          r_vs_plan: number | null
          realized_r_multiple: number | null
          signal_day_of_week: number | null
          signal_detected_at: string | null
          signal_grade: string | null
          signal_id: string
          signal_instrument: string | null
          signal_time_of_day: number | null
          signal_trading_session: string | null
          stop_provenance: string | null
          swap: number | null
          trade_state: string
          updated_at: string
          user_decision: Database["public"]["Enums"]["decision_kind"]
          user_id: string
          verification_level: string
        }
        Insert: {
          actual_entry_at?: string | null
          actual_entry_price?: number | null
          actual_exit_at?: string | null
          actual_exit_price?: number | null
          actual_initial_stop?: number | null
          broker_ticket?: string | null
          commission?: number | null
          cost_currency?: string | null
          cost_unit?: string | null
          created_at?: string
          decision_source?: string
          decision_source_client?: string | null
          derived_r?: number | null
          id?: string
          net_r?: number | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["trade_outcome"]
          partial_exits?: Json | null
          planned_direction?: string | null
          planned_entry?: number | null
          planned_stop?: number | null
          price_recorded_at?: string | null
          price_source?: string | null
          price_source_client?: string | null
          r_availability?: string | null
          r_math_version?: number | null
          r_vs_actual_risk?: number | null
          r_vs_plan?: number | null
          realized_r_multiple?: number | null
          signal_day_of_week?: number | null
          signal_detected_at?: string | null
          signal_grade?: string | null
          signal_id: string
          signal_instrument?: string | null
          signal_time_of_day?: number | null
          signal_trading_session?: string | null
          stop_provenance?: string | null
          swap?: number | null
          trade_state?: string
          updated_at?: string
          user_decision: Database["public"]["Enums"]["decision_kind"]
          user_id?: string
          verification_level?: string
        }
        Update: {
          actual_entry_at?: string | null
          actual_entry_price?: number | null
          actual_exit_at?: string | null
          actual_exit_price?: number | null
          actual_initial_stop?: number | null
          broker_ticket?: string | null
          commission?: number | null
          cost_currency?: string | null
          cost_unit?: string | null
          created_at?: string
          decision_source?: string
          decision_source_client?: string | null
          derived_r?: number | null
          id?: string
          net_r?: number | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["trade_outcome"]
          partial_exits?: Json | null
          planned_direction?: string | null
          planned_entry?: number | null
          planned_stop?: number | null
          price_recorded_at?: string | null
          price_source?: string | null
          price_source_client?: string | null
          r_availability?: string | null
          r_math_version?: number | null
          r_vs_actual_risk?: number | null
          r_vs_plan?: number | null
          realized_r_multiple?: number | null
          signal_day_of_week?: number | null
          signal_detected_at?: string | null
          signal_grade?: string | null
          signal_id?: string
          signal_instrument?: string | null
          signal_time_of_day?: number | null
          signal_trading_session?: string | null
          stop_provenance?: string | null
          swap?: number | null
          trade_state?: string
          updated_at?: string
          user_decision?: Database["public"]["Enums"]["decision_kind"]
          user_id?: string
          verification_level?: string
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
      execution_control_changes: {
        Row: {
          changed_at: string
          changed_by: string
          control_key: string
          evidence: Json
          id: number
          new_value: Json | null
          old_value: Json | null
          reason: string
        }
        Insert: {
          changed_at?: string
          changed_by: string
          control_key: string
          evidence?: Json
          id?: number
          new_value?: Json | null
          old_value?: Json | null
          reason: string
        }
        Update: {
          changed_at?: string
          changed_by?: string
          control_key?: string
          evidence?: Json
          id?: number
          new_value?: Json | null
          old_value?: Json | null
          reason?: string
        }
        Relationships: []
      }
      execution_controls: {
        Row: {
          allowed_live_hosts: string[]
          benchmark_auto_enabled: boolean
          demo_auto_enabled: boolean
          disabled_bridges: string[]
          disabled_instruments: string[]
          execution_policy: string
          force_dry_run: boolean
          id: boolean
          lifecycle_enforced: boolean
          live_auto_enabled: boolean
          live_confirm_enabled: boolean
          live_execution_enabled: boolean
          note: string | null
          updated_at: string
        }
        Insert: {
          allowed_live_hosts?: string[]
          benchmark_auto_enabled?: boolean
          demo_auto_enabled?: boolean
          disabled_bridges?: string[]
          disabled_instruments?: string[]
          execution_policy?: string
          force_dry_run?: boolean
          id?: boolean
          lifecycle_enforced?: boolean
          live_auto_enabled?: boolean
          live_confirm_enabled?: boolean
          live_execution_enabled?: boolean
          note?: string | null
          updated_at?: string
        }
        Update: {
          allowed_live_hosts?: string[]
          benchmark_auto_enabled?: boolean
          demo_auto_enabled?: boolean
          disabled_bridges?: string[]
          disabled_instruments?: string[]
          execution_policy?: string
          force_dry_run?: boolean
          id?: boolean
          lifecycle_enforced?: boolean
          live_auto_enabled?: boolean
          live_confirm_enabled?: boolean
          live_execution_enabled?: boolean
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      execution_deliveries: {
        Row: {
          account_mode: string | null
          attempts: number
          bridge_profile: string
          broker_order_id: string | null
          broker_order_state: string | null
          broker_position_id: string | null
          broker_retcode: number | null
          broker_retcode_string: string | null
          broker_state_at: string | null
          broker_symbol: string | null
          claimed_at: string | null
          client_id: string | null
          connected_account_id: string | null
          destination_type: string
          dry_run: boolean
          endpoint_host: string | null
          enqueued_at: string
          entry_mode: string | null
          execution_config_version: number | null
          execution_policy: string
          final_look_at: string | null
          final_look_reason: string | null
          http_status: number | null
          id: number
          latency_ms: number | null
          lease_expires_at: string | null
          magic: number | null
          margin_currency: string | null
          margin_estimate: number | null
          next_attempt_at: string | null
          payload_version: number
          price_grid_moved: boolean | null
          price_grid_source: string | null
          price_grid_tick: number | null
          published_entry: number | null
          published_stop: number | null
          published_target: number | null
          reason: string | null
          request_fingerprint: string | null
          sent_at: string | null
          settled_at: string | null
          signal_id: string
          state: string
          submitted_at: string | null
          submitted_entry: number | null
          submitted_quantity_sizing_model: number | null
          submitted_quantity_spec_as_of: string | null
          submitted_quantity_spec_source: string | null
          submitted_stop: number | null
          submitted_target: number | null
          submitted_volume: number | null
          user_id: string | null
        }
        Insert: {
          account_mode?: string | null
          attempts?: number
          bridge_profile?: string
          broker_order_id?: string | null
          broker_order_state?: string | null
          broker_position_id?: string | null
          broker_retcode?: number | null
          broker_retcode_string?: string | null
          broker_state_at?: string | null
          broker_symbol?: string | null
          claimed_at?: string | null
          client_id?: string | null
          connected_account_id?: string | null
          destination_type?: string
          dry_run?: boolean
          endpoint_host?: string | null
          enqueued_at?: string
          entry_mode?: string | null
          execution_config_version?: number | null
          execution_policy?: string
          final_look_at?: string | null
          final_look_reason?: string | null
          http_status?: number | null
          id?: number
          latency_ms?: number | null
          lease_expires_at?: string | null
          magic?: number | null
          margin_currency?: string | null
          margin_estimate?: number | null
          next_attempt_at?: string | null
          payload_version?: number
          price_grid_moved?: boolean | null
          price_grid_source?: string | null
          price_grid_tick?: number | null
          published_entry?: number | null
          published_stop?: number | null
          published_target?: number | null
          reason?: string | null
          request_fingerprint?: string | null
          sent_at?: string | null
          settled_at?: string | null
          signal_id: string
          state?: string
          submitted_at?: string | null
          submitted_entry?: number | null
          submitted_quantity_sizing_model?: number | null
          submitted_quantity_spec_as_of?: string | null
          submitted_quantity_spec_source?: string | null
          submitted_stop?: number | null
          submitted_target?: number | null
          submitted_volume?: number | null
          user_id?: string | null
        }
        Update: {
          account_mode?: string | null
          attempts?: number
          bridge_profile?: string
          broker_order_id?: string | null
          broker_order_state?: string | null
          broker_position_id?: string | null
          broker_retcode?: number | null
          broker_retcode_string?: string | null
          broker_state_at?: string | null
          broker_symbol?: string | null
          claimed_at?: string | null
          client_id?: string | null
          connected_account_id?: string | null
          destination_type?: string
          dry_run?: boolean
          endpoint_host?: string | null
          enqueued_at?: string
          entry_mode?: string | null
          execution_config_version?: number | null
          execution_policy?: string
          final_look_at?: string | null
          final_look_reason?: string | null
          http_status?: number | null
          id?: number
          latency_ms?: number | null
          lease_expires_at?: string | null
          magic?: number | null
          margin_currency?: string | null
          margin_estimate?: number | null
          next_attempt_at?: string | null
          payload_version?: number
          price_grid_moved?: boolean | null
          price_grid_source?: string | null
          price_grid_tick?: number | null
          published_entry?: number | null
          published_stop?: number | null
          published_target?: number | null
          reason?: string | null
          request_fingerprint?: string | null
          sent_at?: string | null
          settled_at?: string | null
          signal_id?: string
          state?: string
          submitted_at?: string | null
          submitted_entry?: number | null
          submitted_quantity_sizing_model?: number | null
          submitted_quantity_spec_as_of?: string | null
          submitted_quantity_spec_source?: string | null
          submitted_stop?: number | null
          submitted_target?: number | null
          submitted_volume?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_deliveries_connected_account_id_fkey"
            columns: ["connected_account_id"]
            isOneToOne: false
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_deliveries_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_enqueue_decisions: {
        Row: {
          created_at: string
          decision: string
          detail: string | null
          enqueued: number
          filtered: number
          grade: string | null
          id: number
          instrument: string | null
          signal_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          decision: string
          detail?: string | null
          enqueued?: number
          filtered?: number
          grade?: string | null
          id?: number
          instrument?: string | null
          signal_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          decision?: string
          detail?: string | null
          enqueued?: number
          filtered?: number
          grade?: string | null
          id?: number
          instrument?: string | null
          signal_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      experiment_arms: {
        Row: {
          arm_label: string
          ci_hi: number | null
          ci_lo: number | null
          cluster_n: number
          computed_at: string
          evidence_level: string
          experiment_id: string
          hypothesis_key: string
          id: string
          n_observations: number
          p_value: number | null
          point_estimate: number | null
          q_value: number | null
          r_basis: string | null
          rng_seed: number | null
          run_id: string | null
          stat_method: string | null
          stat_version: number | null
        }
        Insert: {
          arm_label: string
          ci_hi?: number | null
          ci_lo?: number | null
          cluster_n?: number
          computed_at?: string
          evidence_level?: string
          experiment_id: string
          hypothesis_key: string
          id?: string
          n_observations?: number
          p_value?: number | null
          point_estimate?: number | null
          q_value?: number | null
          r_basis?: string | null
          rng_seed?: number | null
          run_id?: string | null
          stat_method?: string | null
          stat_version?: number | null
        }
        Update: {
          arm_label?: string
          ci_hi?: number | null
          ci_lo?: number | null
          cluster_n?: number
          computed_at?: string
          evidence_level?: string
          experiment_id?: string
          hypothesis_key?: string
          id?: string
          n_observations?: number
          p_value?: number | null
          point_estimate?: number | null
          q_value?: number | null
          r_basis?: string | null
          rng_seed?: number | null
          run_id?: string | null
          stat_method?: string | null
          stat_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "experiment_arms_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          closed_at: string | null
          declared_at: string
          declared_keys: string[]
          family_key: string
          holdout_policy: string
          hypothesis: string
          id: string
          multiplicity_method: string
          practical_effect_threshold: number
          primary_metric: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          declared_at?: string
          declared_keys: string[]
          family_key: string
          holdout_policy: string
          hypothesis: string
          id?: string
          multiplicity_method?: string
          practical_effect_threshold: number
          primary_metric: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          declared_at?: string
          declared_keys?: string[]
          family_key?: string
          holdout_policy?: string
          hypothesis?: string
          id?: string
          multiplicity_method?: string
          practical_effect_threshold?: number
          primary_metric?: string
          status?: string
        }
        Relationships: []
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
          plan_origin: string
          reason: string | null
          replay_coverage: number | null
          run_id: string
          sd_r: number | null
          se_r: number | null
          slice_dim: string
          slice_key: string
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
          plan_origin?: string
          reason?: string | null
          replay_coverage?: number | null
          run_id: string
          sd_r?: number | null
          se_r?: number | null
          slice_dim?: string
          slice_key?: string
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
          plan_origin?: string
          reason?: string | null
          replay_coverage?: number | null
          run_id?: string
          sd_r?: number | null
          se_r?: number | null
          slice_dim?: string
          slice_key?: string
          stat_status?: string
          strategy_version?: number
          terminal_replay_horizon_hours?: number
        }
        Relationships: []
      }
      gate_change_proposals: {
        Row: {
          applied_at: string | null
          auto_applied: boolean
          created_at: string
          current_value: number | null
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          gate: string
          id: string
          origin: string
          proposed_by: string
          proposed_value: number
          reverted_at: string | null
          stats_snapshot: Json
          status: string
          updated_at: string
          verdict: string
        }
        Insert: {
          applied_at?: string | null
          auto_applied?: boolean
          created_at?: string
          current_value?: number | null
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          gate: string
          id?: string
          origin?: string
          proposed_by: string
          proposed_value: number
          reverted_at?: string | null
          stats_snapshot: Json
          status?: string
          updated_at?: string
          verdict: string
        }
        Update: {
          applied_at?: string | null
          auto_applied?: boolean
          created_at?: string
          current_value?: number | null
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          gate?: string
          id?: string
          origin?: string
          proposed_by?: string
          proposed_value?: number
          reverted_at?: string | null
          stats_snapshot?: Json
          status?: string
          updated_at?: string
          verdict?: string
        }
        Relationships: []
      }
      gate_threshold_overrides: {
        Row: {
          gate: string
          proposal_id: string | null
          reason: string
          set_by: string
          updated_at: string
          value: number
        }
        Insert: {
          gate: string
          proposal_id?: string | null
          reason: string
          set_by: string
          updated_at?: string
          value: number
        }
        Update: {
          gate?: string
          proposal_id?: string | null
          reason?: string
          set_by?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "gate_threshold_overrides_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "gate_change_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      instrument_alias_discovery: {
        Row: {
          asset_class: string
          candidates: string[]
          canonical: string
          created_at: string
          evidence: Json | null
          id: number
          observed_at: string
          outcome: string
          provider_symbol: string | null
          reason: string | null
        }
        Insert: {
          asset_class: string
          candidates?: string[]
          canonical: string
          created_at?: string
          evidence?: Json | null
          id?: number
          observed_at?: string
          outcome: string
          provider_symbol?: string | null
          reason?: string | null
        }
        Update: {
          asset_class?: string
          candidates?: string[]
          canonical?: string
          created_at?: string
          evidence?: Json | null
          id?: number
          observed_at?: string
          outcome?: string
          provider_symbol?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      instrument_atr_snapshots: {
        Row: {
          atr: number
          atr_period: number
          atr_version: number
          candle_as_of: string
          created_at: string
          id: number
          instrument: string
          timeframe: string
        }
        Insert: {
          atr: number
          atr_period: number
          atr_version: number
          candle_as_of: string
          created_at?: string
          id?: number
          instrument: string
          timeframe: string
        }
        Update: {
          atr?: number
          atr_period?: number
          atr_version?: number
          candle_as_of?: string
          created_at?: string
          id?: number
          instrument?: string
          timeframe?: string
        }
        Relationships: []
      }
      instrument_calendar_bindings: {
        Row: {
          asset_class: string
          calendar_key: string
          calendar_version: number
          created_at: string
          note: string | null
          source: string
          symbol: string
          updated_at: string
        }
        Insert: {
          asset_class: string
          calendar_key: string
          calendar_version: number
          created_at?: string
          note?: string | null
          source?: string
          symbol: string
          updated_at?: string
        }
        Update: {
          asset_class?: string
          calendar_key?: string
          calendar_version?: number
          created_at?: string
          note?: string | null
          source?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      instrument_correlation_groups: {
        Row: {
          created_at: string
          group_key: string
          rationale: string
          symbol: string
        }
        Insert: {
          created_at?: string
          group_key: string
          rationale: string
          symbol: string
        }
        Update: {
          created_at?: string
          group_key?: string
          rationale?: string
          symbol?: string
        }
        Relationships: []
      }
      instrument_health: {
        Row: {
          available: boolean
          breaker_open_until: string | null
          consecutive_failures: number
          failure_scope: string | null
          instrument: string
          last_error: string | null
          unavailable_until: string | null
          updated_at: string
        }
        Insert: {
          available?: boolean
          breaker_open_until?: string | null
          consecutive_failures?: number
          failure_scope?: string | null
          instrument: string
          last_error?: string | null
          unavailable_until?: string | null
          updated_at?: string
        }
        Update: {
          available?: boolean
          breaker_open_until?: string | null
          consecutive_failures?: number
          failure_scope?: string | null
          instrument?: string
          last_error?: string | null
          unavailable_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      instrument_lifecycle: {
        Row: {
          created_at: string
          data_health: string | null
          pre_suspension_stage:
            | Database["public"]["Enums"]["instrument_stage"]
            | null
          stage: Database["public"]["Enums"]["instrument_stage"]
          symbol: string
          updated_at: string
          wave: number
        }
        Insert: {
          created_at?: string
          data_health?: string | null
          pre_suspension_stage?:
            | Database["public"]["Enums"]["instrument_stage"]
            | null
          stage?: Database["public"]["Enums"]["instrument_stage"]
          symbol: string
          updated_at?: string
          wave?: number
        }
        Update: {
          created_at?: string
          data_health?: string | null
          pre_suspension_stage?:
            | Database["public"]["Enums"]["instrument_stage"]
            | null
          stage?: Database["public"]["Enums"]["instrument_stage"]
          symbol?: string
          updated_at?: string
          wave?: number
        }
        Relationships: []
      }
      instrument_lifecycle_transitions: {
        Row: {
          approver: string | null
          code_hash: string | null
          created_at: string
          evidence: Json | null
          from_stage: Database["public"]["Enums"]["instrument_stage"] | null
          id: number
          reason: string
          rollback_target:
            | Database["public"]["Enums"]["instrument_stage"]
            | null
          strategy_model_version: number | null
          symbol: string
          to_stage: Database["public"]["Enums"]["instrument_stage"]
        }
        Insert: {
          approver?: string | null
          code_hash?: string | null
          created_at?: string
          evidence?: Json | null
          from_stage?: Database["public"]["Enums"]["instrument_stage"] | null
          id?: number
          reason: string
          rollback_target?:
            | Database["public"]["Enums"]["instrument_stage"]
            | null
          strategy_model_version?: number | null
          symbol: string
          to_stage: Database["public"]["Enums"]["instrument_stage"]
        }
        Update: {
          approver?: string | null
          code_hash?: string | null
          created_at?: string
          evidence?: Json | null
          from_stage?: Database["public"]["Enums"]["instrument_stage"] | null
          id?: number
          reason?: string
          rollback_target?:
            | Database["public"]["Enums"]["instrument_stage"]
            | null
          strategy_model_version?: number | null
          symbol?: string
          to_stage?: Database["public"]["Enums"]["instrument_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "instrument_lifecycle_transitions_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "instrument_lifecycle"
            referencedColumns: ["symbol"]
          },
          {
            foreignKeyName: "instrument_lifecycle_transitions_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "instrument_stages"
            referencedColumns: ["symbol"]
          },
        ]
      }
      instrument_readiness_snapshots: {
        Row: {
          candle_policy_version: number | null
          checked_at: string
          checks: Json
          code_hash: string | null
          conversion: Json
          conversion_data_ready: boolean | null
          conversion_live: Json | null
          conversion_route_ready: boolean | null
          created_at: string
          execution_conversion_ready: boolean | null
          id: number
          instrument: string
          mapping: Json
          provider_symbol: string | null
          ready: boolean
          series: Json
          spec_fields: Json
          spread_floor_candidate: number | null
        }
        Insert: {
          candle_policy_version?: number | null
          checked_at?: string
          checks: Json
          code_hash?: string | null
          conversion?: Json
          conversion_data_ready?: boolean | null
          conversion_live?: Json | null
          conversion_route_ready?: boolean | null
          created_at?: string
          execution_conversion_ready?: boolean | null
          id?: number
          instrument: string
          mapping?: Json
          provider_symbol?: string | null
          ready: boolean
          series?: Json
          spec_fields?: Json
          spread_floor_candidate?: number | null
        }
        Update: {
          candle_policy_version?: number | null
          checked_at?: string
          checks?: Json
          code_hash?: string | null
          conversion?: Json
          conversion_data_ready?: boolean | null
          conversion_live?: Json | null
          conversion_route_ready?: boolean | null
          created_at?: string
          execution_conversion_ready?: boolean | null
          id?: number
          instrument?: string
          mapping?: Json
          provider_symbol?: string | null
          ready?: boolean
          series?: Json
          spec_fields?: Json
          spread_floor_candidate?: number | null
        }
        Relationships: []
      }
      instrument_spread_samples: {
        Row: {
          ask: number | null
          asset_class: string | null
          atr_snapshot_id: number | null
          bid: number | null
          candle_policy_version: number | null
          created_at: string
          digits: number | null
          id: number
          instrument: string
          mapping_verified_at: string | null
          market_state: string
          mid: number | null
          point: number | null
          provider_symbol: string
          quality: string
          quality_reasons: string[]
          received_at: string
          run_id: string
          sampler_version: number
          scope: string
          session: string | null
          session_version: number
          source_time: string | null
          spec_as_of: string | null
          spread_atr_fraction: number | null
          spread_pips: number | null
          spread_points: number | null
          spread_price: number | null
          stage: Database["public"]["Enums"]["instrument_stage"]
          tick_size: number | null
        }
        Insert: {
          ask?: number | null
          asset_class?: string | null
          atr_snapshot_id?: number | null
          bid?: number | null
          candle_policy_version?: number | null
          created_at?: string
          digits?: number | null
          id?: number
          instrument: string
          mapping_verified_at?: string | null
          market_state: string
          mid?: number | null
          point?: number | null
          provider_symbol: string
          quality: string
          quality_reasons?: string[]
          received_at?: string
          run_id: string
          sampler_version: number
          scope?: string
          session?: string | null
          session_version: number
          source_time?: string | null
          spec_as_of?: string | null
          spread_atr_fraction?: number | null
          spread_pips?: number | null
          spread_points?: number | null
          spread_price?: number | null
          stage: Database["public"]["Enums"]["instrument_stage"]
          tick_size?: number | null
        }
        Update: {
          ask?: number | null
          asset_class?: string | null
          atr_snapshot_id?: number | null
          bid?: number | null
          candle_policy_version?: number | null
          created_at?: string
          digits?: number | null
          id?: number
          instrument?: string
          mapping_verified_at?: string | null
          market_state?: string
          mid?: number | null
          point?: number | null
          provider_symbol?: string
          quality?: string
          quality_reasons?: string[]
          received_at?: string
          run_id?: string
          sampler_version?: number
          scope?: string
          session?: string | null
          session_version?: number
          source_time?: string | null
          spec_as_of?: string | null
          spread_atr_fraction?: number | null
          spread_pips?: number | null
          spread_points?: number | null
          spread_price?: number | null
          stage?: Database["public"]["Enums"]["instrument_stage"]
          tick_size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "instrument_spread_samples_atr_snapshot_id_fkey"
            columns: ["atr_snapshot_id"]
            isOneToOne: false
            referencedRelation: "instrument_atr_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instrument_spread_samples_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "spread_sampler_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      instrument_spread_stats: {
        Row: {
          asset_class: string | null
          calculated_at: string
          computation_version: number
          coverage_end: string | null
          coverage_start: string | null
          distinct_trading_days: number
          excluded_samples: number
          instrument: string
          max_spread_price: number | null
          median_atr_fraction: number | null
          missingness: number | null
          p50_spread_points: number | null
          p50_spread_price: number | null
          p75_spread_price: number | null
          p90_atr_fraction: number | null
          p90_spread_points: number | null
          p90_spread_price: number | null
          p95_spread_price: number | null
          p99_spread_price: number | null
          raw_samples: number
          scope: string
          session: string
          session_coverage: number | null
          session_version: number
          stage: Database["public"]["Enums"]["instrument_stage"]
          trading_date: string
          valid_samples: number
        }
        Insert: {
          asset_class?: string | null
          calculated_at?: string
          computation_version: number
          coverage_end?: string | null
          coverage_start?: string | null
          distinct_trading_days: number
          excluded_samples: number
          instrument: string
          max_spread_price?: number | null
          median_atr_fraction?: number | null
          missingness?: number | null
          p50_spread_points?: number | null
          p50_spread_price?: number | null
          p75_spread_price?: number | null
          p90_atr_fraction?: number | null
          p90_spread_points?: number | null
          p90_spread_price?: number | null
          p95_spread_price?: number | null
          p99_spread_price?: number | null
          raw_samples: number
          scope: string
          session: string
          session_coverage?: number | null
          session_version: number
          stage: Database["public"]["Enums"]["instrument_stage"]
          trading_date: string
          valid_samples: number
        }
        Update: {
          asset_class?: string | null
          calculated_at?: string
          computation_version?: number
          coverage_end?: string | null
          coverage_start?: string | null
          distinct_trading_days?: number
          excluded_samples?: number
          instrument?: string
          max_spread_price?: number | null
          median_atr_fraction?: number | null
          missingness?: number | null
          p50_spread_points?: number | null
          p50_spread_price?: number | null
          p75_spread_price?: number | null
          p90_atr_fraction?: number | null
          p90_spread_points?: number | null
          p90_spread_price?: number | null
          p95_spread_price?: number | null
          p99_spread_price?: number | null
          raw_samples?: number
          scope?: string
          session?: string
          session_coverage?: number | null
          session_version?: number
          stage?: Database["public"]["Enums"]["instrument_stage"]
          trading_date?: string
          valid_samples?: number
        }
        Relationships: []
      }
      instrument_symbol_bindings: {
        Row: {
          bound_by: string
          candidates: string[]
          canonical: string
          created_at: string
          evidence: Json
          provider_symbol: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          bound_by: string
          candidates?: string[]
          canonical: string
          created_at?: string
          evidence?: Json
          provider_symbol: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          bound_by?: string
          candidates?: string[]
          canonical?: string
          created_at?: string
          evidence?: Json
          provider_symbol?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      market_context: {
        Row: {
          created_at: string
          day_of_week: number
          id: string
          session_version: number | null
          signal_id: string
          time_of_day: number
          trading_session: string
          volatility_index: number | null
        }
        Insert: {
          created_at?: string
          day_of_week: number
          id?: string
          session_version?: number | null
          signal_id: string
          time_of_day: number
          trading_session: string
          volatility_index?: number | null
        }
        Update: {
          created_at?: string
          day_of_week?: number
          id?: string
          session_version?: number | null
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
      metaapi_api_observations: {
        Row: {
          account_id: string | null
          cost_units: number
          detail: string | null
          http_status: number | null
          id: number
          latency_ms: number | null
          observed_at: string
          outcome: string
          surface: string
        }
        Insert: {
          account_id?: string | null
          cost_units?: number
          detail?: string | null
          http_status?: number | null
          id?: number
          latency_ms?: number | null
          observed_at?: string
          outcome: string
          surface: string
        }
        Update: {
          account_id?: string | null
          cost_units?: number
          detail?: string | null
          http_status?: number | null
          id?: number
          latency_ms?: number | null
          observed_at?: string
          outcome?: string
          surface?: string
        }
        Relationships: []
      }
      model_observations: {
        Row: {
          candle_as_of: string | null
          candle_policy_version: number | null
          candle_source: string | null
          canonical_instrument: string | null
          code_hash: string | null
          decision: string
          direction: string | null
          disposition: string
          family: string | null
          grade: string | null
          id: string
          instrument: string
          latency_ms: number | null
          lifecycle_stage_at_detection: string | null
          mapping_verified_at: string | null
          model_version: number
          observation_key: string | null
          observed_at: string
          profile: Json | null
          provider_symbol: string | null
          quote_as_of: string | null
          reason: string | null
          research_cohort: string | null
          run_id: string | null
          session_version: number | null
          signal_id: string | null
          spec_as_of: string | null
          suppression_reason: string | null
        }
        Insert: {
          candle_as_of?: string | null
          candle_policy_version?: number | null
          candle_source?: string | null
          canonical_instrument?: string | null
          code_hash?: string | null
          decision: string
          direction?: string | null
          disposition?: string
          family?: string | null
          grade?: string | null
          id?: string
          instrument: string
          latency_ms?: number | null
          lifecycle_stage_at_detection?: string | null
          mapping_verified_at?: string | null
          model_version: number
          observation_key?: string | null
          observed_at?: string
          profile?: Json | null
          provider_symbol?: string | null
          quote_as_of?: string | null
          reason?: string | null
          research_cohort?: string | null
          run_id?: string | null
          session_version?: number | null
          signal_id?: string | null
          spec_as_of?: string | null
          suppression_reason?: string | null
        }
        Update: {
          candle_as_of?: string | null
          candle_policy_version?: number | null
          candle_source?: string | null
          canonical_instrument?: string | null
          code_hash?: string | null
          decision?: string
          direction?: string | null
          disposition?: string
          family?: string | null
          grade?: string | null
          id?: string
          instrument?: string
          latency_ms?: number | null
          lifecycle_stage_at_detection?: string | null
          mapping_verified_at?: string | null
          model_version?: number
          observation_key?: string | null
          observed_at?: string
          profile?: Json | null
          provider_symbol?: string | null
          quote_as_of?: string | null
          reason?: string | null
          research_cohort?: string | null
          run_id?: string | null
          session_version?: number | null
          signal_id?: string | null
          spec_as_of?: string | null
          suppression_reason?: string | null
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
      news_coverage_snapshots: {
        Row: {
          computed_at: string
          country: string | null
          coverage_state: string
          created_at: string
          currency: string | null
          event_family: string
          events_with_exact_time: number
          freshness_seconds: number | null
          id: number
          last_successful_run_at: string | null
          latest_event_at: string | null
          mapping_version: string | null
          note: string | null
          provider: string
          scheduled_events: number
          source_version: string | null
        }
        Insert: {
          computed_at?: string
          country?: string | null
          coverage_state: string
          created_at?: string
          currency?: string | null
          event_family: string
          events_with_exact_time?: number
          freshness_seconds?: number | null
          id?: number
          last_successful_run_at?: string | null
          latest_event_at?: string | null
          mapping_version?: string | null
          note?: string | null
          provider: string
          scheduled_events?: number
          source_version?: string | null
        }
        Update: {
          computed_at?: string
          country?: string | null
          coverage_state?: string
          created_at?: string
          currency?: string | null
          event_family?: string
          events_with_exact_time?: number
          freshness_seconds?: number | null
          id?: number
          last_successful_run_at?: string | null
          latest_event_at?: string | null
          mapping_version?: string | null
          note?: string | null
          provider?: string
          scheduled_events?: number
          source_version?: string | null
        }
        Relationships: []
      }
      news_ingestion_runs: {
        Row: {
          batch_status: string
          completed_at: string | null
          created_at: string
          duplicates: number
          duration_ms: number | null
          error_class: string | null
          error_note: string | null
          events_received: number
          id: number
          inserts: number
          invalid_events: number
          job: string
          provider: string
          request_count: number
          response_status: number | null
          retry_count: number
          revisions: number
          scheduled_at: string | null
          started_at: string
          updates: number
          window_from: string | null
          window_to: string | null
          worker_version: string
        }
        Insert: {
          batch_status?: string
          completed_at?: string | null
          created_at?: string
          duplicates?: number
          duration_ms?: number | null
          error_class?: string | null
          error_note?: string | null
          events_received?: number
          id?: number
          inserts?: number
          invalid_events?: number
          job: string
          provider: string
          request_count?: number
          response_status?: number | null
          retry_count?: number
          revisions?: number
          scheduled_at?: string | null
          started_at?: string
          updates?: number
          window_from?: string | null
          window_to?: string | null
          worker_version: string
        }
        Update: {
          batch_status?: string
          completed_at?: string | null
          created_at?: string
          duplicates?: number
          duration_ms?: number | null
          error_class?: string | null
          error_note?: string | null
          events_received?: number
          id?: number
          inserts?: number
          invalid_events?: number
          job?: string
          provider?: string
          request_count?: number
          response_status?: number | null
          retry_count?: number
          revisions?: number
          scheduled_at?: string | null
          started_at?: string
          updates?: number
          window_from?: string | null
          window_to?: string | null
          worker_version?: string
        }
        Relationships: []
      }
      news_policy_evaluations: {
        Row: {
          boundary: string
          coverage_state: string
          created_at: string
          decision: string
          delivery_id: number | null
          evaluated_at: string
          event_ids: string[]
          id: number
          instrument: string
          mode: string
          news_policy_version: string
          news_snapshot_version: string
          reason: string | null
          required_currencies: string[]
          required_families: string[]
          signal_id: string | null
          wave: number | null
        }
        Insert: {
          boundary: string
          coverage_state: string
          created_at?: string
          decision: string
          delivery_id?: number | null
          evaluated_at?: string
          event_ids?: string[]
          id?: number
          instrument: string
          mode: string
          news_policy_version: string
          news_snapshot_version: string
          reason?: string | null
          required_currencies?: string[]
          required_families?: string[]
          signal_id?: string | null
          wave?: number | null
        }
        Update: {
          boundary?: string
          coverage_state?: string
          created_at?: string
          decision?: string
          delivery_id?: number | null
          evaluated_at?: string
          event_ids?: string[]
          id?: number
          instrument?: string
          mode?: string
          news_policy_version?: string
          news_snapshot_version?: string
          reason?: string | null
          required_currencies?: string[]
          required_families?: string[]
          signal_id?: string | null
          wave?: number | null
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
          candle_as_of: string | null
          candle_policy_version: number | null
          candle_source: string | null
          canonical_instrument: string | null
          cf_grade: string | null
          cf_max_r: number | null
          cf_plan_version: number | null
          cf_tp1: number | null
          cf_tp1_r: number | null
          cf_tp2: number | null
          cf_tp2_r: number | null
          cf_tp3: number | null
          cf_tp3_r: number | null
          code_hash: string | null
          confidence_score: number | null
          counterfactual_class: string | null
          counterfactual_stage: string | null
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
          lifecycle_stage_at_detection: string | null
          manifest_hash: string
          mapping_verified_at: string | null
          max_r: number | null
          observation_key: string | null
          plan_origin: string | null
          provider_symbol: string | null
          published_signal_id: string | null
          quote_as_of: string | null
          research_cohort: string | null
          research_plan_version: number | null
          risk_price: number | null
          run_id: string | null
          session_version: number | null
          spec_as_of: string | null
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
          candle_as_of?: string | null
          candle_policy_version?: number | null
          candle_source?: string | null
          canonical_instrument?: string | null
          cf_grade?: string | null
          cf_max_r?: number | null
          cf_plan_version?: number | null
          cf_tp1?: number | null
          cf_tp1_r?: number | null
          cf_tp2?: number | null
          cf_tp2_r?: number | null
          cf_tp3?: number | null
          cf_tp3_r?: number | null
          code_hash?: string | null
          confidence_score?: number | null
          counterfactual_class?: string | null
          counterfactual_stage?: string | null
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
          lifecycle_stage_at_detection?: string | null
          manifest_hash: string
          mapping_verified_at?: string | null
          max_r?: number | null
          observation_key?: string | null
          plan_origin?: string | null
          provider_symbol?: string | null
          published_signal_id?: string | null
          quote_as_of?: string | null
          research_cohort?: string | null
          research_plan_version?: number | null
          risk_price?: number | null
          run_id?: string | null
          session_version?: number | null
          spec_as_of?: string | null
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
          candle_as_of?: string | null
          candle_policy_version?: number | null
          candle_source?: string | null
          canonical_instrument?: string | null
          cf_grade?: string | null
          cf_max_r?: number | null
          cf_plan_version?: number | null
          cf_tp1?: number | null
          cf_tp1_r?: number | null
          cf_tp2?: number | null
          cf_tp2_r?: number | null
          cf_tp3?: number | null
          cf_tp3_r?: number | null
          code_hash?: string | null
          confidence_score?: number | null
          counterfactual_class?: string | null
          counterfactual_stage?: string | null
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
          lifecycle_stage_at_detection?: string | null
          manifest_hash?: string
          mapping_verified_at?: string | null
          max_r?: number | null
          observation_key?: string | null
          plan_origin?: string | null
          provider_symbol?: string | null
          published_signal_id?: string | null
          quote_as_of?: string | null
          research_cohort?: string | null
          research_plan_version?: number | null
          risk_price?: number | null
          run_id?: string | null
          session_version?: number | null
          spec_as_of?: string | null
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
      scanner_capacity_samples: {
        Row: {
          alert_failures: number
          alert_latency_ms: number | null
          breaker_events: number
          candle_failures: number
          chain_depth: number | null
          created_at: string
          cycle_duration_ms: number | null
          db_write_failures: number
          details: Json
          enqueue_failures: number
          enqueue_latency_ms: number | null
          id: number
          job_duration_ms: number | null
          provider_errors: number
          provider_requests: number
          provider_throttles: number
          queue_age_ms: number | null
          quote_failures: number
          resolver_backlog: number | null
          resolver_oldest_age_ms: number | null
          resolver_throughput: number | null
          run_id: string | null
          sampled_at: string
          source: string
          stale_jobs: number
          timeouts: number
          wave0_alerts: number
          wave0_execution_decisions: number
          wave0_publications: number
        }
        Insert: {
          alert_failures?: number
          alert_latency_ms?: number | null
          breaker_events?: number
          candle_failures?: number
          chain_depth?: number | null
          created_at?: string
          cycle_duration_ms?: number | null
          db_write_failures?: number
          details?: Json
          enqueue_failures?: number
          enqueue_latency_ms?: number | null
          id?: number
          job_duration_ms?: number | null
          provider_errors?: number
          provider_requests?: number
          provider_throttles?: number
          queue_age_ms?: number | null
          quote_failures?: number
          resolver_backlog?: number | null
          resolver_oldest_age_ms?: number | null
          resolver_throughput?: number | null
          run_id?: string | null
          sampled_at?: string
          source: string
          stale_jobs?: number
          timeouts?: number
          wave0_alerts?: number
          wave0_execution_decisions?: number
          wave0_publications?: number
        }
        Update: {
          alert_failures?: number
          alert_latency_ms?: number | null
          breaker_events?: number
          candle_failures?: number
          chain_depth?: number | null
          created_at?: string
          cycle_duration_ms?: number | null
          db_write_failures?: number
          details?: Json
          enqueue_failures?: number
          enqueue_latency_ms?: number | null
          id?: number
          job_duration_ms?: number | null
          provider_errors?: number
          provider_requests?: number
          provider_throttles?: number
          queue_age_ms?: number | null
          quote_failures?: number
          resolver_backlog?: number | null
          resolver_oldest_age_ms?: number | null
          resolver_throughput?: number | null
          run_id?: string | null
          sampled_at?: string
          source?: string
          stale_jobs?: number
          timeouts?: number
          wave0_alerts?: number
          wave0_execution_decisions?: number
          wave0_publications?: number
        }
        Relationships: []
      }
      scanner_settings: {
        Row: {
          account_currency: string
          account_equity: number
          adaptive_order_ceiling_floor: number
          adaptive_order_ceiling_max: number
          adaptive_order_ceilings_enabled: boolean
          alert_min_grade: Database["public"]["Enums"]["signal_grade"]
          allow_unmeasured_intel: boolean
          auto_execute_c_grade: boolean
          auto_intel_gate_enabled: boolean
          auto_intel_min_sample: number
          auto_intel_min_win_pct: number | null
          auto_market_entry_enabled: boolean
          auto_order_window_minutes: number
          created_at: string
          daily_setup_cap: number
          equity_as_of: string | null
          execution_config_version: number
          execution_dry_run: boolean
          execution_enabled: boolean
          exposure_limit_enabled: boolean
          instruments: string[]
          leverage: number
          live_execution_confirmed_at: string | null
          live_execution_confirmed_global_live: boolean
          live_execution_confirmed_host: string | null
          live_execution_confirmed_version: number | null
          max_position_size: number
          max_stop_loss_percent: number
          maximum_active_signal_orders: number
          maximum_concurrent_signal_orders: number
          maximum_daily_orders_per_symbol: number
          maximum_daily_signal_orders: number
          min_grade: Database["public"]["Enums"]["signal_grade"]
          notify_email: boolean
          notify_push: boolean
          order_strategy: string
          risk_ack_high: boolean
          risk_per_trade_percent: number
          sessions: string[]
          timeframes: string[]
          updated_at: string
          user_id: string
          webhook_enabled: boolean
          webhook_format: string
          webhook_secret: string | null
          webhook_url: string | null
          webhook_validated_at: string | null
          webhook_validation_reason: string | null
        }
        Insert: {
          account_currency?: string
          account_equity?: number
          adaptive_order_ceiling_floor?: number
          adaptive_order_ceiling_max?: number
          adaptive_order_ceilings_enabled?: boolean
          alert_min_grade?: Database["public"]["Enums"]["signal_grade"]
          allow_unmeasured_intel?: boolean
          auto_execute_c_grade?: boolean
          auto_intel_gate_enabled?: boolean
          auto_intel_min_sample?: number
          auto_intel_min_win_pct?: number | null
          auto_market_entry_enabled?: boolean
          auto_order_window_minutes?: number
          created_at?: string
          daily_setup_cap?: number
          equity_as_of?: string | null
          execution_config_version?: number
          execution_dry_run?: boolean
          execution_enabled?: boolean
          exposure_limit_enabled?: boolean
          instruments?: string[]
          leverage?: number
          live_execution_confirmed_at?: string | null
          live_execution_confirmed_global_live?: boolean
          live_execution_confirmed_host?: string | null
          live_execution_confirmed_version?: number | null
          max_position_size?: number
          max_stop_loss_percent?: number
          maximum_active_signal_orders?: number
          maximum_concurrent_signal_orders?: number
          maximum_daily_orders_per_symbol?: number
          maximum_daily_signal_orders?: number
          min_grade?: Database["public"]["Enums"]["signal_grade"]
          notify_email?: boolean
          notify_push?: boolean
          order_strategy?: string
          risk_ack_high?: boolean
          risk_per_trade_percent?: number
          sessions?: string[]
          timeframes?: string[]
          updated_at?: string
          user_id: string
          webhook_enabled?: boolean
          webhook_format?: string
          webhook_secret?: string | null
          webhook_url?: string | null
          webhook_validated_at?: string | null
          webhook_validation_reason?: string | null
        }
        Update: {
          account_currency?: string
          account_equity?: number
          adaptive_order_ceiling_floor?: number
          adaptive_order_ceiling_max?: number
          adaptive_order_ceilings_enabled?: boolean
          alert_min_grade?: Database["public"]["Enums"]["signal_grade"]
          allow_unmeasured_intel?: boolean
          auto_execute_c_grade?: boolean
          auto_intel_gate_enabled?: boolean
          auto_intel_min_sample?: number
          auto_intel_min_win_pct?: number | null
          auto_market_entry_enabled?: boolean
          auto_order_window_minutes?: number
          created_at?: string
          daily_setup_cap?: number
          equity_as_of?: string | null
          execution_config_version?: number
          execution_dry_run?: boolean
          execution_enabled?: boolean
          exposure_limit_enabled?: boolean
          instruments?: string[]
          leverage?: number
          live_execution_confirmed_at?: string | null
          live_execution_confirmed_global_live?: boolean
          live_execution_confirmed_host?: string | null
          live_execution_confirmed_version?: number | null
          max_position_size?: number
          max_stop_loss_percent?: number
          maximum_active_signal_orders?: number
          maximum_concurrent_signal_orders?: number
          maximum_daily_orders_per_symbol?: number
          maximum_daily_signal_orders?: number
          min_grade?: Database["public"]["Enums"]["signal_grade"]
          notify_email?: boolean
          notify_push?: boolean
          order_strategy?: string
          risk_ack_high?: boolean
          risk_per_trade_percent?: number
          sessions?: string[]
          timeframes?: string[]
          updated_at?: string
          user_id?: string
          webhook_enabled?: boolean
          webhook_format?: string
          webhook_secret?: string | null
          webhook_url?: string | null
          webhook_validated_at?: string | null
          webhook_validation_reason?: string | null
        }
        Relationships: []
      }
      session_definitions: {
        Row: {
          algorithm: string
          boundaries: Json
          created_at: string
          dst_aware: boolean
          name: string
          notes: string | null
          timezone_model: string
          version: number
        }
        Insert: {
          algorithm: string
          boundaries: Json
          created_at?: string
          dst_aware?: boolean
          name: string
          notes?: string | null
          timezone_model: string
          version: number
        }
        Update: {
          algorithm?: string
          boundaries?: Json
          created_at?: string
          dst_aware?: boolean
          name?: string
          notes?: string | null
          timezone_model?: string
          version?: number
        }
        Relationships: []
      }
      shadow_engine_state: {
        Row: {
          active_replay_version: number
          auto_apply_gate_changes: boolean
          candidate_capture_enabled: boolean
          candidate_enrolment_enabled: boolean
          candidate_rows_per_run: number
          consecutive_failures: number
          fill_gate_notified_at: string | null
          id: boolean
          last_error: string | null
          last_run_at: string | null
          model_readiness_notified_at: string | null
          paused: boolean
          paused_until: string | null
          replay_v2_shadow_enabled: boolean
          research_errors: number
          research_last_error: string | null
          research_last_error_at: string | null
          sizing_v2_enabled: boolean
          updated_at: string
          v2_enabled: boolean
          v3_enabled: boolean
          win_gate_notified_at: string | null
        }
        Insert: {
          active_replay_version?: number
          auto_apply_gate_changes?: boolean
          candidate_capture_enabled?: boolean
          candidate_enrolment_enabled?: boolean
          candidate_rows_per_run?: number
          consecutive_failures?: number
          fill_gate_notified_at?: string | null
          id?: boolean
          last_error?: string | null
          last_run_at?: string | null
          model_readiness_notified_at?: string | null
          paused?: boolean
          paused_until?: string | null
          replay_v2_shadow_enabled?: boolean
          research_errors?: number
          research_last_error?: string | null
          research_last_error_at?: string | null
          sizing_v2_enabled?: boolean
          updated_at?: string
          v2_enabled?: boolean
          v3_enabled?: boolean
          win_gate_notified_at?: string | null
        }
        Update: {
          active_replay_version?: number
          auto_apply_gate_changes?: boolean
          candidate_capture_enabled?: boolean
          candidate_enrolment_enabled?: boolean
          candidate_rows_per_run?: number
          consecutive_failures?: number
          fill_gate_notified_at?: string | null
          id?: boolean
          last_error?: string | null
          last_run_at?: string | null
          model_readiness_notified_at?: string | null
          paused?: boolean
          paused_until?: string | null
          replay_v2_shadow_enabled?: boolean
          research_errors?: number
          research_last_error?: string | null
          research_last_error_at?: string | null
          sizing_v2_enabled?: boolean
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
          candle_finality_policy: string | null
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
          plan_origin: string
          quality_grade: string | null
          realized_r: number | null
          replay_cursor: string | null
          replay_version: number
          research_candidate_id: string | null
          research_window_status: string | null
          resolved_at: string | null
          resolved_outcome: string | null
          resolver_version: number | null
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
          candle_finality_policy?: string | null
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
          plan_origin?: string
          quality_grade?: string | null
          realized_r?: number | null
          replay_cursor?: string | null
          replay_version?: number
          research_candidate_id?: string | null
          research_window_status?: string | null
          resolved_at?: string | null
          resolved_outcome?: string | null
          resolver_version?: number | null
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
          candle_finality_policy?: string | null
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
          plan_origin?: string
          quality_grade?: string | null
          realized_r?: number | null
          replay_cursor?: string | null
          replay_version?: number
          research_candidate_id?: string | null
          research_window_status?: string | null
          resolved_at?: string | null
          resolved_outcome?: string | null
          resolver_version?: number | null
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
      sizing_divergence_log: {
        Row: {
          authoritative_model: number
          created_at: string
          id: string
          instrument: string
          lots_delta: number | null
          risk_delta: number | null
          signal_id: string | null
          spec_source: string
          summary: string | null
          user_id: string | null
          v1_lots: number | null
          v1_reason: string | null
          v2_lots: number | null
          v2_reason: string | null
        }
        Insert: {
          authoritative_model: number
          created_at?: string
          id?: string
          instrument: string
          lots_delta?: number | null
          risk_delta?: number | null
          signal_id?: string | null
          spec_source: string
          summary?: string | null
          user_id?: string | null
          v1_lots?: number | null
          v1_reason?: string | null
          v2_lots?: number | null
          v2_reason?: string | null
        }
        Update: {
          authoritative_model?: number
          created_at?: string
          id?: string
          instrument?: string
          lots_delta?: number | null
          risk_delta?: number | null
          signal_id?: string | null
          spec_source?: string
          summary?: string | null
          user_id?: string | null
          v1_lots?: number | null
          v1_reason?: string | null
          v2_lots?: number | null
          v2_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sizing_divergence_log_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "scanned_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_refresh_attempts: {
        Row: {
          attempts: number
          last_attempt_at: string
          last_error: string | null
          last_outcome: string | null
          symbol: string
        }
        Insert: {
          attempts?: number
          last_attempt_at?: string
          last_error?: string | null
          last_outcome?: string | null
          symbol: string
        }
        Update: {
          attempts?: number
          last_attempt_at?: string
          last_error?: string | null
          last_outcome?: string | null
          symbol?: string
        }
        Relationships: []
      }
      spread_sampler_runs: {
        Row: {
          attempted_instruments: string[]
          breaker_skipped: string[]
          created_at: string
          duplicate_source_times: number
          duration_ms: number | null
          error_class: string | null
          expected_instruments: string[]
          failed_requests: number
          finished_at: string | null
          invalid_samples: number
          killed: boolean
          provider_outage: boolean
          request_count: number
          retry_count: number
          run_id: string
          sampler_version: number
          scheduled_at: string
          stage_skipped: string[]
          started_at: string
          succeeded_instruments: string[]
          timed_out: boolean
        }
        Insert: {
          attempted_instruments?: string[]
          breaker_skipped?: string[]
          created_at?: string
          duplicate_source_times?: number
          duration_ms?: number | null
          error_class?: string | null
          expected_instruments: string[]
          failed_requests?: number
          finished_at?: string | null
          invalid_samples?: number
          killed?: boolean
          provider_outage?: boolean
          request_count?: number
          retry_count?: number
          run_id?: string
          sampler_version: number
          scheduled_at: string
          stage_skipped?: string[]
          started_at?: string
          succeeded_instruments?: string[]
          timed_out?: boolean
        }
        Update: {
          attempted_instruments?: string[]
          breaker_skipped?: string[]
          created_at?: string
          duplicate_source_times?: number
          duration_ms?: number | null
          error_class?: string | null
          expected_instruments?: string[]
          failed_requests?: number
          finished_at?: string | null
          invalid_samples?: number
          killed?: boolean
          provider_outage?: boolean
          request_count?: number
          retry_count?: number
          run_id?: string
          sampler_version?: number
          scheduled_at?: string
          stage_skipped?: string[]
          started_at?: string
          succeeded_instruments?: string[]
          timed_out?: boolean
        }
        Relationships: []
      }
      telemetry_budget: {
        Row: {
          account_id: string
          consecutive_failures: number
          last_claimed_at: string | null
          next_allowed_at: string
          parked_reason: string | null
          source: string
        }
        Insert: {
          account_id: string
          consecutive_failures?: number
          last_claimed_at?: string | null
          next_allowed_at?: string
          parked_reason?: string | null
          source: string
        }
        Update: {
          account_id?: string
          consecutive_failures?: number
          last_claimed_at?: string | null
          next_allowed_at?: string
          parked_reason?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "telemetry_budget_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "connected_trading_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      telemetry_controls: {
        Row: {
          aggregation_enabled: boolean
          atr_retention_days: number
          breaker_cooldown_minutes: number
          capacity_enabled: boolean
          capacity_retention_days: number
          daily_request_budget: number
          id: boolean
          max_instruments_per_run: number
          max_requests_per_run: number
          note: string | null
          observation_retention_days: number
          readiness_enabled: boolean
          retention_enabled: boolean
          sample_retention_days: number
          sampler_enabled: boolean
          sampler_symbols: string[]
          updated_at: string
        }
        Insert: {
          aggregation_enabled?: boolean
          atr_retention_days?: number
          breaker_cooldown_minutes?: number
          capacity_enabled?: boolean
          capacity_retention_days?: number
          daily_request_budget?: number
          id?: boolean
          max_instruments_per_run?: number
          max_requests_per_run?: number
          note?: string | null
          observation_retention_days?: number
          readiness_enabled?: boolean
          retention_enabled?: boolean
          sample_retention_days?: number
          sampler_enabled?: boolean
          sampler_symbols?: string[]
          updated_at?: string
        }
        Update: {
          aggregation_enabled?: boolean
          atr_retention_days?: number
          breaker_cooldown_minutes?: number
          capacity_enabled?: boolean
          capacity_retention_days?: number
          daily_request_budget?: number
          id?: boolean
          max_instruments_per_run?: number
          max_requests_per_run?: number
          note?: string | null
          observation_retention_days?: number
          readiness_enabled?: boolean
          retention_enabled?: boolean
          sample_retention_days?: number
          sampler_enabled?: boolean
          sampler_symbols?: string[]
          updated_at?: string
        }
        Relationships: []
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
      instrument_spread_samples_valid: {
        Row: {
          ask: number | null
          atr_snapshot_id: number | null
          bid: number | null
          created_at: string | null
          digits: number | null
          id: number | null
          instrument: string | null
          mapping_verified_at: string | null
          market_state: string | null
          mid: number | null
          point: number | null
          provider_symbol: string | null
          quality: string | null
          quality_reasons: string[] | null
          received_at: string | null
          run_id: string | null
          sampler_version: number | null
          scope: string | null
          session: string | null
          session_version: number | null
          source_time: string | null
          spec_as_of: string | null
          spread_atr_fraction: number | null
          spread_pips: number | null
          spread_points: number | null
          spread_price: number | null
          stage: Database["public"]["Enums"]["instrument_stage"] | null
          tick_size: number | null
        }
        Insert: {
          ask?: number | null
          atr_snapshot_id?: number | null
          bid?: number | null
          created_at?: string | null
          digits?: number | null
          id?: number | null
          instrument?: string | null
          mapping_verified_at?: string | null
          market_state?: string | null
          mid?: number | null
          point?: number | null
          provider_symbol?: string | null
          quality?: string | null
          quality_reasons?: string[] | null
          received_at?: string | null
          run_id?: string | null
          sampler_version?: number | null
          scope?: string | null
          session?: string | null
          session_version?: number | null
          source_time?: string | null
          spec_as_of?: string | null
          spread_atr_fraction?: number | null
          spread_pips?: number | null
          spread_points?: number | null
          spread_price?: number | null
          stage?: Database["public"]["Enums"]["instrument_stage"] | null
          tick_size?: number | null
        }
        Update: {
          ask?: number | null
          atr_snapshot_id?: number | null
          bid?: number | null
          created_at?: string | null
          digits?: number | null
          id?: number | null
          instrument?: string | null
          mapping_verified_at?: string | null
          market_state?: string | null
          mid?: number | null
          point?: number | null
          provider_symbol?: string | null
          quality?: string | null
          quality_reasons?: string[] | null
          received_at?: string | null
          run_id?: string | null
          sampler_version?: number | null
          scope?: string | null
          session?: string | null
          session_version?: number | null
          source_time?: string | null
          spec_as_of?: string | null
          spread_atr_fraction?: number | null
          spread_pips?: number | null
          spread_points?: number | null
          spread_price?: number | null
          stage?: Database["public"]["Enums"]["instrument_stage"] | null
          tick_size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "instrument_spread_samples_atr_snapshot_id_fkey"
            columns: ["atr_snapshot_id"]
            isOneToOne: false
            referencedRelation: "instrument_atr_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instrument_spread_samples_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "spread_sampler_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      instrument_stages: {
        Row: {
          stage: Database["public"]["Enums"]["instrument_stage"] | null
          symbol: string | null
        }
        Insert: {
          stage?: Database["public"]["Enums"]["instrument_stage"] | null
          symbol?: string | null
        }
        Update: {
          stage?: Database["public"]["Enums"]["instrument_stage"] | null
          symbol?: string | null
        }
        Relationships: []
      }
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
      account_quota: {
        Args: { _user_id: string }
        Returns: {
          max_demo: number
          max_live: number
        }[]
      }
      admin_reset_shadow_breaker: { Args: never; Returns: Json }
      claim_account_telemetry: {
        Args: {
          _account_id: string
          _min_interval_seconds: number
          _source: string
        }
        Returns: boolean
      }
      claim_and_enrol_model_shadow: {
        Args: {
          _atr: number
          _claim_model_version: number
          _cooldown_minutes: number
          _detected_at: string
          _direction: string
          _entry_price: number
          _entry_source?: string
          _grade: string
          _instrument: string
          _max_r: number
          _model_version: number
          _observation_key: string
          _quality_grade: string
          _risk_price: number
          _stop_anchor?: string
          _stop_loss: number
          _strategy_family: string
          _structure_key: string
          _tp1: number
          _tp1_r: number
          _tp2: number
          _tp2_r: number
          _tp3: number
          _tp3_r: number
          _trading_session: string
        }
        Returns: Json
      }
      claim_execution_delivery: {
        Args: { lease_seconds?: number }
        Returns: {
          account_mode: string
          attempts: number
          bridge_profile: string
          connected_account_id: string
          destination_type: string
          dry_run: boolean
          enqueued_at: string
          execution_config_version: number
          id: number
          signal_id: string
          user_id: string
        }[]
      }
      claim_learning_milestone: { Args: { _gate: string }; Returns: boolean }
      claim_sampler_slot: {
        Args: {
          _expected: string[]
          _sampler_version: number
          _scheduled_at: string
        }
        Returns: string
      }
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
      claim_spec_refresh: {
        Args: { _min_interval_seconds: number; _symbol: string }
        Returns: boolean
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
      decide_gate_change: {
        Args: {
          _actor: string
          _decision: string
          _id: string
          _reason: string
        }
        Returns: Json
      }
      enrol_research_candidate_shadow: {
        Args: {
          _candidate_id: string
          _claim_model_version?: number
          _cohort?: string
          _cooldown_minutes?: number
          _execution_policy?: string
          _expected_plan_version?: number
          _plan_origin?: string
          _replay_version?: number
        }
        Returns: Json
      }
      expire_execution_leases: { Args: never; Returns: number }
      gate_default_value: { Args: { _gate: string }; Returns: number }
      gate_readiness: { Args: never; Returns: Json }
      get_admin_author_split: { Args: never; Returns: Json }
      get_admin_candidate_funnel: { Args: never; Returns: Json }
      get_admin_candidate_lineage: {
        Args: { _limit?: number; _offset?: number }
        Returns: Json
      }
      get_admin_commissioning: { Args: never; Returns: Json }
      get_admin_engine_status: { Args: never; Returns: Json }
      get_admin_experiments: { Args: never; Returns: Json }
      get_admin_filter_lift: { Args: never; Returns: Json }
      get_admin_instrument_diagnostics: { Args: never; Returns: Json }
      get_admin_intelligence: { Args: never; Returns: Json }
      get_admin_learning_evidence: { Args: never; Returns: Json }
      get_admin_news: { Args: never; Returns: Json }
      get_admin_payoff_research: { Args: never; Returns: Json }
      instrument_capability_allowed: {
        Args: { _capability: string; _instrument: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      maintain_scan_queue: { Args: never; Returns: Json }
      maintain_shadow_queue: { Args: never; Returns: Json }
      park_account_telemetry: {
        Args: {
          _account_id: string
          _reason: string
          _retry_after_seconds: number
          _source: string
        }
        Returns: undefined
      }
      propose_gate_change: {
        Args: {
          _actor: string
          _gate: string
          _proposed_value: number
          _reason: string
        }
        Returns: Json
      }
      prune_v2_structure_claims: { Args: never; Returns: number }
      purge_expired_signals: { Args: never; Returns: number }
      purge_news_data: { Args: never; Returns: Json }
      purge_telemetry: { Args: never; Returns: Json }
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
      recompute_spread_stats: { Args: { _days?: number }; Returns: Json }
      record_spec_refresh_outcome: {
        Args: { _error: string; _outcome: string; _symbol: string }
        Returns: undefined
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
      run_gate_change_automation: { Args: never; Returns: Json }
      session_of_v1: { Args: { _at: string }; Returns: string }
      set_auto_apply_gate_changes: {
        Args: { _actor: string; _enabled: boolean; _reason: string }
        Returns: Json
      }
      set_execution_control: {
        Args: {
          _changed_by: string
          _evidence?: Json
          _expected_old?: Json
          _key: string
          _reason: string
          _value: Json
        }
        Returns: Json
      }
      set_telemetry_control: {
        Args: {
          _changed_by: string
          _key: string
          _reason: string
          _value: Json
        }
        Returns: Json
      }
      transition_instrument_stage: {
        Args: {
          _approver: string
          _code_hash?: string
          _evidence?: Json
          _expected_from: string
          _reason: string
          _rollback_target?: string
          _strategy_model_version?: number
          _symbol: string
          _to: string
        }
        Returns: Json
      }
    }
    Enums: {
      decision_kind: "taken" | "skipped"
      instrument_stage:
        | "disabled"
        | "data_validation"
        | "shadow"
        | "signals_only"
        | "execution_approved"
        | "suspended"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      instrument_stage: [
        "disabled",
        "data_validation",
        "shadow",
        "signals_only",
        "execution_approved",
        "suspended",
      ],
      signal_grade: ["A", "B", "C", "A+"],
      tf_code: ["H4", "H1", "M15"],
      trade_direction: ["long", "short"],
      trade_outcome: ["win", "loss", "breakeven", "open"],
    },
  },
} as const
