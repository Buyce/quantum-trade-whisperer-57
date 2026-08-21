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
  first_seen: string | null;
  last_seen: string | null;
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
}

export const EMPTY_CANDIDATE_FUNNEL: CandidateFunnel = {
  generated_at: new Date(0).toISOString(),
  flags: null,
  totals: null,
  by_stage: [],
  by_instrument: [],
  gate_outcomes: [],
  by_plan_origin: [],
  cohort_counts: {},
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
