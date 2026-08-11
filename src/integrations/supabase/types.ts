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
      executed_trades: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          outcome: Database["public"]["Enums"]["trade_outcome"]
          realized_r_multiple: number | null
          signal_id: string
          updated_at: string
          user_decision: Database["public"]["Enums"]["decision_kind"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["trade_outcome"]
          realized_r_multiple?: number | null
          signal_id: string
          updated_at?: string
          user_decision: Database["public"]["Enums"]["decision_kind"]
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["trade_outcome"]
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
          volatility_index: number
        }
        Insert: {
          created_at?: string
          day_of_week: number
          id?: string
          signal_id: string
          time_of_day: number
          trading_session: string
          volatility_index?: number
        }
        Update: {
          created_at?: string
          day_of_week?: number
          id?: string
          signal_id?: string
          time_of_day?: number
          trading_session?: string
          volatility_index?: number
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deletion_requested_at: string | null
          deletion_scheduled_for: string | null
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          deletion_scheduled_for?: string | null
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          deletion_scheduled_for?: string | null
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
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
          expired_at: string | null
          grade: Database["public"]["Enums"]["signal_grade"]
          h1_bias: string | null
          h4_bias: string | null
          id: string
          instrument: string
          m15_bias: string | null
          p_momentum: number | null
          p_order_block: number | null
          p_trend: number | null
          p_volatility_expansion: number | null
          pattern_symmetry: number
          pillars_passed: number | null
          qualitative_breakdown: string
          resolved_outcome: Database["public"]["Enums"]["trade_outcome"]
          resolved_r_multiple: number | null
          rr_ratio: number
          status: string
          stop_loss: number
          tp1: number
          tp2: number
          tp3: number
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
          expired_at?: string | null
          grade: Database["public"]["Enums"]["signal_grade"]
          h1_bias?: string | null
          h4_bias?: string | null
          id?: string
          instrument: string
          m15_bias?: string | null
          p_momentum?: number | null
          p_order_block?: number | null
          p_trend?: number | null
          p_volatility_expansion?: number | null
          pattern_symmetry?: number
          pillars_passed?: number | null
          qualitative_breakdown?: string
          resolved_outcome?: Database["public"]["Enums"]["trade_outcome"]
          resolved_r_multiple?: number | null
          rr_ratio: number
          status?: string
          stop_loss: number
          tp1: number
          tp2: number
          tp3: number
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
          expired_at?: string | null
          grade?: Database["public"]["Enums"]["signal_grade"]
          h1_bias?: string | null
          h4_bias?: string | null
          id?: string
          instrument?: string
          m15_bias?: string | null
          p_momentum?: number | null
          p_order_block?: number | null
          p_trend?: number | null
          p_volatility_expansion?: number | null
          pattern_symmetry?: number
          pillars_passed?: number | null
          qualitative_breakdown?: string
          resolved_outcome?: Database["public"]["Enums"]["trade_outcome"]
          resolved_r_multiple?: number | null
          rr_ratio?: number
          status?: string
          stop_loss?: number
          tp1?: number
          tp2?: number
          tp3?: number
        }
        Relationships: []
      }
      scanner_settings: {
        Row: {
          alert_min_grade: Database["public"]["Enums"]["signal_grade"]
          created_at: string
          daily_setup_cap: number
          instruments: string[]
          min_grade: Database["public"]["Enums"]["signal_grade"]
          notify_email: boolean
          notify_push: boolean
          sessions: string[]
          timeframes: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_min_grade?: Database["public"]["Enums"]["signal_grade"]
          created_at?: string
          daily_setup_cap?: number
          instruments?: string[]
          min_grade?: Database["public"]["Enums"]["signal_grade"]
          notify_email?: boolean
          notify_push?: boolean
          sessions?: string[]
          timeframes?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_min_grade?: Database["public"]["Enums"]["signal_grade"]
          created_at?: string
          daily_setup_cap?: number
          instruments?: string[]
          min_grade?: Database["public"]["Enums"]["signal_grade"]
          notify_email?: boolean
          notify_push?: boolean
          sessions?: string[]
          timeframes?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_scan_job: {
        Args: never
        Returns: {
          id: number
          instrument: string
        }[]
      }
      purge_expired_signals: { Args: never; Returns: number }
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
