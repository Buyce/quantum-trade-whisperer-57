/**
 * Prompt 14 Stage 5 (pre-flight 5) — pooled broker research consent, as pure
 * rules.
 *
 * Broker evidence from a CUSTOMER account is that customer's trading data. It
 * may only enter a pooled research population when the owner has explicitly said
 * so, at a known consent version, and it must stop entering as soon as they
 * withdraw. Two properties follow and are enforced here rather than at a call
 * site:
 *
 *  1. Consent defaults to FALSE. An absent, unreadable or older-version consent
 *     is not consent.
 *  2. Withdrawal is FORWARD-looking. Rows already collected under a valid
 *     consent stay in the population they were collected into — silently
 *     rewriting history would corrupt the statistics — but nothing further is
 *     added.
 *
 * The pseudonymous research reference (`research_account_ref`) is the only
 * account identity that ever reaches a research surface. It is a random opaque
 * token: it contains no user id, no broker login, no email and no MetaApi
 * account id, and it cannot be reversed into any of them.
 *
 * Pure: no I/O, no clock beyond the value passed in.
 */

/**
 * Current consent text version. Raising this invalidates prior consent for
 * FUTURE inclusion, because the person agreed to different words.
 */
export const RESEARCH_CONSENT_VERSION = 1;

/** Prospective evidence phases. Set at first observation, never after outcome. */
export const EVIDENCE_PHASES = ["development", "validation", "forward_holdout"] as const;

export type EvidencePhase = (typeof EVIDENCE_PHASES)[number];

/**
 * Out-of-sample holdout is NOT available. Nothing in P-Trades may claim an
 * out-of-sample result while this is false.
 */
export const HOLDOUT_AVAILABLE = false;

export interface ConsentState {
  researchConsent: boolean | null | undefined;
  researchConsentVersion: number | null | undefined;
  researchConsentAt: string | null | undefined;
}

export type ConsentVerdict = { included: true; version: number } | { included: false; reason: string };

/**
 * May this account's FUTURE broker evidence be pooled for research?
 *
 * Every unknown is a refusal.
 */
export function pooledInclusionAllowed(
  state: ConsentState,
  currentVersion: number = RESEARCH_CONSENT_VERSION,
): ConsentVerdict {
  if (state.researchConsent !== true) {
    return { included: false, reason: "the account owner has not consented to pooled research" };
  }
  if (typeof state.researchConsentVersion !== "number") {
    return { included: false, reason: "no consent version was recorded" };
  }
  if (state.researchConsentVersion !== currentVersion) {
    return {
      included: false,
      reason: `consent was given for version ${state.researchConsentVersion}, current is version ${currentVersion}`,
    };
  }
  if (!state.researchConsentAt || !Number.isFinite(Date.parse(state.researchConsentAt))) {
    return { included: false, reason: "no usable consent timestamp was recorded" };
  }
  return { included: true, version: currentVersion };
}

/**
 * TRUE when the token is safe to publish on a research surface.
 *
 * Rejects anything that looks like a uuid, an email, or a numeric broker login,
 * so a refactor cannot quietly start emitting a real identifier.
 */
export function isSafeResearchRef(
  ref: string | null | undefined,
  forbidden: readonly (string | null | undefined)[] = [],
): boolean {
  if (!ref || typeof ref !== "string") return false;
  if (!/^ra_[0-9a-f]{32}$/.test(ref)) return false;
  for (const value of forbidden) {
    if (!value) continue;
    const needle = String(value).replace(/-/g, "").toLowerCase();
    if (needle.length >= 6 && ref.toLowerCase().includes(needle)) return false;
  }
  return true;
}

/** Phase may be set once; after an outcome exists it is frozen. */
export function phaseChangeAllowed(hasOutcome: boolean): boolean {
  return !hasOutcome;
}

/**
 * News context for broker evidence.
 *
 * There is NO verified economic-calendar provider integrated. Anything else
 * would be a guess dressed as a fact, so the only permitted value is `unknown`.
 */
export const NEWS_CONTEXT_UNKNOWN = "unknown" as const;

export function newsContextFor(): typeof NEWS_CONTEXT_UNKNOWN {
  return NEWS_CONTEXT_UNKNOWN;
}
