/**
 * The Data API rejects a freshly issued sign-in token with PGRST303
 * ("JWT issued at future" / "JWT not yet valid") when its clock is behind the
 * sign-in service. Errors arrive as plain PostgREST objects ({ code, message }),
 * not Error instances, so both shapes are checked. Real sign-in failures are
 * not retried.
 */
function errorText(error: unknown): { code: string; msg: string } {
  if (typeof error === "string") return { code: "", msg: error };
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; message?: unknown };
    return {
      code: typeof e.code === "string" ? e.code : "",
      msg: typeof e.message === "string" ? e.message : "",
    };
  }
  return { code: "", msg: "" };
}

export function isClockSkewError(error: unknown): boolean {
  const { code, msg } = errorText(error);
  if (code === "PGRST303" && /future|not yet valid/i.test(msg)) return true;
  return /issued at future|iat.*future|not\s*yet\s*valid|not.*valid yet/i.test(msg);
}

/** Up to 3 tries for clock skew; real auth failures are not retried. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isClockSkewError(error)) return failureCount < 3;
  const { msg } = errorText(error);
  if (/unauthori[sz]ed|forbidden|invalid token/i.test(msg)) return false;
  return failureCount < 3;
}

/** Wait ~2 s between clock-skew retries. */
export function retryDelay(attempt: number, error: unknown): number {
  if (isClockSkewError(error)) return 2000;
  return Math.min(1000 * 2 ** attempt, 30000);
}

/**
 * Shown only after retries are exhausted, so it does not promise the problem
 * will clear by itself: a persistent rejection is a backend fault.
 */
export function friendlyLoadError(error: unknown, fallback: string): string {
  if (isClockSkewError(error))
    return "The server is refusing valid sign-ins right now (backend clock issue — not your account). Nothing is shown rather than guessed. Tap Retry.";
  const { msg } = errorText(error);
  return msg || fallback;
}
