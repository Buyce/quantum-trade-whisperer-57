/**
 * Transfer shapes for the research candidate funnel. Explicit fields only: an
 * opaque `Json` blob would let a schema drift pass silently into the panel.
 */
export interface CandidateFunnelFlags {
  candidate_capture_enabled: boolean;
  candidate_enrolment_enabled: boolean;
  candidate_rows_per_run: number;
  research_errors: number;
  research_last_error: string | null;
  research_last_error_at: string | null;
}

export interface CandidateFunnelTotals {
  n: number;
  n_24h: number;
  published: number;
  with_geometry: number;
  gates_incomplete: number;
  enrolled: number;
  enrolment_backlog: number;
  /** Backlog rows that carry a complete research plan, so are actually enrolable. */
  enrolable_backlog: number;
  /** Detection time of the oldest enrolable row still waiting. */
  oldest_unenrolled_at: string | null;
  first_enrolled_at: string | null;
  last_enrolled_at: string | null;
  /** Detection time of the oldest row already enrolled — proves the backfill reaches back. */
  oldest_enrolled_detected_at: string | null;
  first_seen: string | null;
  last_seen: string | null;
}

export interface CandidateEnrolledDayRow {
  day: string;
  n: number;
  oldest_detected_at: string | null;
}

export interface CandidateStageRow {
  terminal_stage: string;
  n: number;
  with_geometry: number;
}

export interface CandidateInstrumentRow {
  instrument: string;
  direction: string | null;
  n: number;
}

export interface CandidateGateRow {
  gate: string;
  pass: number;
  fail: number;
  not_evaluable: number;
}

export interface CandidateOriginRow {
  plan_origin: string;
  n: number;
  enrolled: number;
}

export interface CandidateFunnel {
  generated_at: string;
  flags: CandidateFunnelFlags | null;
  totals: CandidateFunnelTotals | null;
  by_stage: CandidateStageRow[];
  by_instrument: CandidateInstrumentRow[];
  gate_outcomes: CandidateGateRow[];
  by_plan_origin: CandidateOriginRow[];
  cohort_counts: Record<string, number>;
  /** Enrolments per UTC day, newest first. Empty until the first enrolment lands. */
  enrolled_by_day: CandidateEnrolledDayRow[];
  /** Enrolled rows whose history is older than the provider candle cap can reach. */
  outside_replay_window: number;
}

/**
 * One candidate's full trail: capture -> enrolment -> replay outcome -> (only if
 * it was actually published and auto-ordered) enqueue decision and broker
 * evidence. A rejected candidate never reached a broker, so its broker fields
 * stay null and the UI says "never sent" instead of implying a fill.
 */
export interface CandidateLineageRow {
  candidate_id: string;
  instrument: string;
  direction: string | null;
  grade: string | null;
  cf_grade: string | null;
  detected_at: string;
  enrolled_at: string | null;
  published_signal_id: string | null;
  v1_decision: string | null;
  shadow_status: string | null;
  shadow_outcome: string | null;
  shadow_realized_r: number | null;
  shadow_resolved_at: string | null;
  research_window_status: string | null;
  enqueue_decision: string | null;
  enqueue_reason: string | null;
  broker_state: string | null;
  broker_r_vs_plan: number | null;
  broker_net_profit: number | null;
  broker_currency: string | null;
}

export interface CandidateLineage {
  generated_at: string;
  rows: CandidateLineageRow[];
  total: number;
}

export const EMPTY_CANDIDATE_LINEAGE: CandidateLineage = {
  generated_at: new Date(0).toISOString(),
  rows: [],
  total: 0,
};

export const EMPTY_CANDIDATE_FUNNEL: CandidateFunnel = {
  generated_at: new Date(0).toISOString(),
  flags: null,
  totals: null,
  by_stage: [],
  by_instrument: [],
  gate_outcomes: [],
  by_plan_origin: [],
  cohort_counts: {},
  enrolled_by_day: [],
  outside_replay_window: 0,
};

/** Human label for each terminal evaluation stage. */
export const STAGE_LABELS: Record<string, string> = {
  published: "Published",
  no_candles: "No candle data",
  m15_neutral: "No M15 direction",
  no_grade: "Failed grading",
  no_abc: "No ABC structure",
  risk_undefined: "Risk undefined",
  risk_too_wide: "Risk above ATR ceiling",
  no_headroom: "No headroom to barrier",
  unreachable_r: "Reachable R below floor",
};
