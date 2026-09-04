/**
 * Per-order live confirmation — pure rules.
 *
 * A `live_confirm` account never has orders placed for it automatically. The
 * engine queues a REQUEST, and only an explicit owner confirmation on that exact
 * request makes it submittable. Nothing here infers consent: a missing, declined
 * or expired confirmation is always "not confirmed".
 */

export type ConfirmationState = "awaiting" | "confirmed" | "declined" | "expired";

export interface ConfirmationFacts {
  state: string;
  requiresConfirmation: boolean | null;
  confirmedAt: string | null;
  confirmationExpiresAt: string | null;
  declinedAt: string | null;
}

/** How a queued confirmation request currently stands. */
export function confirmationState(facts: ConfirmationFacts, nowMs: number): ConfirmationState {
  if (facts.declinedAt) return "declined";
  if (facts.confirmedAt) return "confirmed";
  const expiry = facts.confirmationExpiresAt;
  if (expiry && new Date(expiry).getTime() <= nowMs) return "expired";
  return "awaiting";
}

/**
 * Whether the owner may still act on this request. Past the expiry the answer is
 * no, so a stale setup can never be confirmed into a live order.
 */
export function confirmationActionable(facts: ConfirmationFacts, nowMs: number): boolean {
  return facts.state === "awaiting_confirmation" && confirmationState(facts, nowMs) === "awaiting";
}

/** Milliseconds left to decide, or null when no window is recorded. */
export function confirmationMsRemaining(expiresAt: string | null, nowMs: number): number | null {
  if (!expiresAt) return null;
  return Math.max(0, new Date(expiresAt).getTime() - nowMs);
}
