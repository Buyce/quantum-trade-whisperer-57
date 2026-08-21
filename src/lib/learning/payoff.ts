/**
 * Payoff estimand types (research only).
 *
 * A probability is not a return. `regime.ts` owns probabilities (p_fill, p_win,
 * pJoint); this module owns expected R, which is an average over a payoff
 * distribution and can only ever be read from resolved replay rows.
 *
 * Estimands
 * - `mean_r_per_plan` (headline): the average R a trader would have earned per
 *   published plan, counting plans that never traded (never filled, or an
 *   entry-side gap beyond the stop) as exactly 0R. This is the only figure that
 *   answers "what does acting on these signals return".
 * - `mean_r_given_executable`: the average R across plans that actually traded.
 *   Strictly conditional; it overstates realised return and must never be
 *   labelled expected value.
 *
 * Nothing in this module feeds the live scanner, the published feed, priors, or
 * any user-facing surface. It exists so the payoff can be measured before it is
 * ever trusted.
 */

export type PayoffEstimand = "mean_r_per_plan" | "mean_r_given_executable";

/** Why a cohort's number may not be used. Only `descriptive` is reportable. */
export type PayoffStatStatus =
  | "descriptive"
  | "insufficient_sample"
  | "insufficient_coverage"
  | "unavailable";

/** Which R column the estimand was built from — provenance, never inferred. */
export type PayoffBasis = "realized_r@planned_risk" | "gross_r@actual_risk";

export interface PayoffCohort {
  model_version: number;
  replay_version: number;
  execution_policy: string;
  estimand: PayoffEstimand;
  tier: number;
  regime_key: string;
  instrument: string | null;
  direction: string | null;

  /** Plans whose full observation horizon had elapsed at the snapshot instant. */
  n_mature: number;
  n_resolved_total: number;
  n_unresolved_mature: number;
  n_per_plan_eligible: number;
  n_executable: number;
  /** Broken observations: excluded from every denominator, never scored 0R. */
  n_invalid_excluded: number;
  /** Resolved but never traded: contributes 0R to the per-plan estimand. */
  n_gap_no_trade: number;
  n_never_filled: number;
  n_legacy_resolved_at_null: number;

  replay_coverage: number | null;
  coverage_threshold: number;

  n_used: number;
  mean_r: number | null;
  sd_r: number | null;
  se_r: number | null;
  ci_method: string | null;
  ci_level: number | null;
  ci_df: number | null;
  ci_lo: number | null;
  ci_hi: number | null;
  cluster_n: number | null;

  payoff_basis: PayoffBasis;
  stat_status: PayoffStatStatus;
  reason: string | null;
  terminal_replay_horizon_hours: number;
  computed_as_of: string;
  run_id: string;
}

/**
 * Registry provenance as shown in the terminal. The immutable `semantics`
 * rulebook itself stays in the database: the hash is what proves identity, and
 * shipping the whole JSON to the client would invite it being treated as config.
 */
export interface PayoffRegistryRow {
  version: number;
  label: string;
  code_hash: string;
  registered_at: string;
  retired_at: string | null;
}

export interface PayoffResearch {
  generated_at: string;
  cohorts: PayoffCohort[];
  registry: PayoffRegistryRow[];
}

/**
 * A cohort's mean is displayable only when the statistics are defined AND the
 * mature cohort is essentially fully resolved. Anything else is a number whose
 * next update could move it materially, so it is withheld rather than shown.
 */
export function isReportable(c: PayoffCohort): boolean {
  return c.stat_status === "descriptive" && c.mean_r !== null;
}

/** Formats R for display without ever inventing precision or a value. */
export function formatR(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}R`;
}
