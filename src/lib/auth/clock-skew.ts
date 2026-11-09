/**
 * "JWT issued at future" means the checking server's clock is a few seconds
 * behind the sign-in service. It clears on its own, so it is retried rather
 * than shown as a failure. Real sign-in failures are not retried.
 */
export function isClockSkewError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /issued at future|iat.*future|token.*not.*valid yet/i.test(msg);
}

/** React Query retry rule: up to 3 tries for clock skew, otherwise the default (3 tries) only for non-auth errors. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isClockSkewError(error)) return failureCount < 3;
  const msg = error instanceof Error ? error.message : "";
  if (/unauthori[sz]ed|forbidden|invalid token/i.test(msg)) return false;
  return failureCount < 3;
}

/** Wait ~2 s between clock-skew retries. */
export function retryDelay(attempt: number, error: unknown): number {
  if (isClockSkewError(error)) return 2000;
  return Math.min(1000 * 2 ** attempt, 30000);
}

export function friendlyLoadError(error: unknown, fallback: string): string {
  if (isClockSkewError(error)) return "Your sign-in is still syncing — tap Retry in a moment.";
  return error instanceof Error ? error.message : fallback;
}
