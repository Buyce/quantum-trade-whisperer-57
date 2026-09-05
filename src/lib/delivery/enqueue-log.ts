/**
 * Plain-language rendering of automatic-order decisions (browser-safe).
 *
 * The wording is deliberately literal: each string says what the engine did and
 * why, and never converts a refusal into a claim about the market or a forecast.
 * An unknown decision code is shown verbatim rather than guessed at.
 */
export const ENQUEUE_DECISION_COPY: Record<string, string> = {
  enqueued: "Queued for your armed account.",
  c_grade_never_executes: "C-Grade setups are never executed automatically.",
  c_grade_blocked_by_user_setting:
    "This is a C-Grade setup and you have not allowed C-Grade automatic orders.",
  c_grade_allowed_by_user_setting:
    "Queued for your armed account as a C-Grade setup, which you have explicitly allowed.",
  automatic_execution_disabled: "Automatic execution is currently switched off system-wide.",
  no_armed_account: "No account is armed for automatic orders.",
  no_settings_row: "Your rules could not be read, so no order was placed.",
  filtered_by_user_rules: "Your own rules excluded this setup.",
  instrument_filtered: "This instrument is not in your selected instruments.",
  session_filtered: "This setup's session is not in your selected sessions.",
  below_alert_grade: "This setup's grade is below your minimum tier.",
  below_min_grade: "This setup's grade is below your minimum tier.",
  expired_retention: "The setup had already expired.",
  execution_window_expired:
    "The setup was already outside your automatic-order window, so no broker order was queued.",
  daily_cap_reached: "Your trades-per-day limit was already used up.",
  cohort_negative_expectancy:
    "This instrument, direction and session combination has lost money across enough resolved replay outcomes that its whole confidence interval sits below break-even, so no order was placed. This is a measured history, not a forecast about this setup.",
  intelligence_gate_below_threshold:
    "The historical win-if-filled rate for this regime is below your intelligence-gate threshold.",
  intelligence_gate_sample_insufficient:
    "Too few resolved replay samples behind this regime to satisfy your intelligence gate. This is a missing measurement, not a prediction.",
  enqueue_attempt_failed:
    "The automatic-order check itself failed, so no order was placed. This is a system fault, not a decision about the setup.",
  concurrent_order_limit_reached:
    "Your ceiling for automatic orders open at once was already in use.",
  daily_order_limit_reached: "Your ceiling for automatic orders per day was already reached.",
  instrument_daily_order_limit_reached:
    "Your ceiling for automatic orders on this instrument today was already reached.",

  intelligence_gate_unmeasured_allowed:
    "This regime has too few resolved replay samples, and you have chosen to let unmeasured setups through your intelligence gate.",
  active_order_limit_reached:
    "Your limit for simultaneous automatic orders is already in use today.",
  active_order_count_unreadable:
    "Your current automatic orders could not be counted, so nothing was queued.",
  instrument_not_approved: "This instrument is not approved for execution yet.",
  news_blackout:
    "A high-impact scheduled event for this instrument was inside your news window, so no automatic order was queued. This is your own news rule, not a prediction about the release.",
  duplicate_resting_order:
    "You already have an automatic order live at your broker for this same setup, so a second one was not placed. Stacking identical orders would multiply the risk you sized for.",
};

export function describeEnqueueDecision(decision: string): string {
  const known = ENQUEUE_DECISION_COPY[decision];
  if (known) return known;
  if (decision.startsWith("enqueue_failed"))
    return "The order could not be queued because of a database error.";
  if (decision.endsWith("unreadable"))
    return "A required record could not be read, so nothing was queued.";
  return decision;
}
