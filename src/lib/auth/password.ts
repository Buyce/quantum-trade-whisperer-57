/**
 * Password rules shared by the sign-in screen, the recovery page and the
 * signed-in change-password form, so all three refuse the same inputs with the
 * same wording.
 */

export const PASSWORD_MIN_LENGTH = 8;
/** Supabase hashes with bcrypt, which silently truncates beyond 72 bytes. */
export const PASSWORD_MAX_LENGTH = 72;

/** Which sign-in methods an account owns, as reported by the auth identities. */
export function isPasswordlessAccount(providers: readonly string[]): boolean {
  return providers.length > 0 && !providers.includes("email");
}

/**
 * Validate a new password plus its confirmation. Returns the first problem in a
 * fixed order so the message never flickers between two complaints.
 */
export function validateNewPassword(
  next: string,
  confirm: string,
): { ok: true } | { ok: false; message: string } {
  if (next.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (next.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer` };
  }
  if (next !== confirm) {
    return { ok: false, message: "The two passwords do not match" };
  }
  return { ok: true };
}

/** What the recovery page is currently able to do. */
export type RecoveryState = "waiting" | "ready" | "expired";

/**
 * A recovery link only works while Supabase has written a recovery session from
 * the URL. Absent a session once the initial check has completed, the link was
 * already used or has expired.
 */
export function recoveryState(hasSession: boolean, checked: boolean): RecoveryState {
  if (hasSession) return "ready";
  return checked ? "expired" : "waiting";
}
