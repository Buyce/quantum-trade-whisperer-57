/**
 * PER-COHORT automatic-order rule, chosen by the owner.
 *
 * A cohort is one instrument and one direction — "EURUSD long", "GBPAUD short".
 * The owner may leave a cohort alone (`allow`), refuse automatic orders on it
 * (`block`), or let it trade with a smaller share of their normal per-trade risk
 * (`reduce`).
 *
 * Reduce-only, like every other automatic-order rule in this product: it can
 * refuse an order or shrink one, and it can do nothing else. It never touches
 * publication, the feed, alerts, grading, replay, shadow enrolment or any
 * statistic, and it can never raise a risk percentage above the owner's profile.
 *
 * Pure and browser-safe: the same module answers the pre-enqueue gate, the
 * pre-send sizing scale and the Settings screen.
 */
export type CohortPolicyKind = "allow" | "reduce" | "block";

export const COHORT_POLICY_KINDS: CohortPolicyKind[] = ["allow", "reduce", "block"];

/** The shares of normal risk a reduced cohort may be given. */
export const COHORT_RISK_SHARES = [25, 50, 75] as const;

export const COHORT_RISK_SHARE_DEFAULT = 50;

export interface CohortPolicyRow {
  instrument: string;
  direction: string;
  policy: string | null;
  risk_share_percent: number | null;
}

export interface CohortPolicyVerdict {
  /** False only for an explicit `block`. */
  allowed: boolean;
  policy: CohortPolicyKind;
  /**
   * Multiplier on the owner's normal per-trade risk, in (0, 1]. Always 1 unless
   * the cohort is explicitly reduced.
   */
  riskScale: number;
  /** Share as a percentage, for copy and for the decision ledger. */
  riskSharePercent: number;
  /** Owner-facing explanation. Null when the rule changed nothing. */
  detail: string | null;
}

const ALLOWED: CohortPolicyVerdict = {
  allowed: true,
  policy: "allow",
  riskScale: 1,
  riskSharePercent: 100,
  detail: null,
};

export function isCohortPolicyKind(value: unknown): value is CohortPolicyKind {
  return typeof value === "string" && (COHORT_POLICY_KINDS as string[]).includes(value);
}

/** Clamp a share to the supported 1–100 band; anything unusable becomes the default. */
export function clampCohortRiskShare(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return COHORT_RISK_SHARE_DEFAULT;
  return Math.min(100, Math.max(1, Math.round(n)));
}

export function cohortKey(instrument: string, direction: string): string {
  return `${instrument.trim().toUpperCase()}:${direction.trim().toLowerCase()}`;
}

/**
 * The owner's rule for this setup's cohort.
 *
 * Absent, unrecognised or unreadable rows mean `allow`: a missing preference can
 * never block an order and can never shrink one, exactly as it behaved before
 * this feature existed. A direction we do not know (the row carried none) is
 * likewise left alone, because a rule about "long" must not silently apply to a
 * setup whose side is unknown.
 */
export function evaluateCohortPolicy(
  rows: CohortPolicyRow[] | null | undefined,
  signal: { instrument: string; direction?: string | null },
): CohortPolicyVerdict {
  const direction = (signal.direction ?? "").trim().toLowerCase();
  if (!direction) return ALLOWED;
  if (!rows || rows.length === 0) return ALLOWED;

  const wanted = cohortKey(signal.instrument, direction);
  const match = rows.find((r) => cohortKey(r.instrument ?? "", r.direction ?? "") === wanted);
  if (!match) return ALLOWED;

  const policy = isCohortPolicyKind(match.policy) ? match.policy : "allow";
  const label = `${signal.instrument.toUpperCase()} ${direction}`;

  if (policy === "block") {
    return {
      allowed: false,
      policy,
      riskScale: 1,
      riskSharePercent: 100,
      detail: `you switched automatic orders off for ${label}`,
    };
  }
  if (policy === "reduce") {
    const share = clampCohortRiskShare(match.risk_share_percent ?? COHORT_RISK_SHARE_DEFAULT);
    // A "reduction" that reduces nothing is treated as no rule at all, so the
    // ledger never claims a smaller size that was never applied.
    if (share >= 100) return ALLOWED;
    return {
      allowed: true,
      policy,
      riskScale: share / 100,
      riskSharePercent: share,
      detail: `you set ${label} to ${share}% of your normal per-trade risk`,
    };
  }
  return ALLOWED;
}

/** Owner-facing summary of a saved rule, for Settings and the assistant. */
export function describeCohortPolicy(row: CohortPolicyRow): string {
  const label = `${(row.instrument ?? "").toUpperCase()} ${(row.direction ?? "").toLowerCase()}`;
  const policy = isCohortPolicyKind(row.policy) ? row.policy : "allow";
  if (policy === "block") return `${label}: automatic orders off`;
  if (policy === "reduce") {
    return `${label}: ${clampCohortRiskShare(row.risk_share_percent)}% of normal risk`;
  }
  return `${label}: automatic orders allowed at normal risk`;
}
