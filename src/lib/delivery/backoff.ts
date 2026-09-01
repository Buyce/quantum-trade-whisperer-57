/**
 * Retry SPACING for momentary delivery refusals.
 *
 * A retryable refusal ("no quote right now", "spread briefly wide", "price ran
 * past the limit") used to return the delivery to `pending` with no schedule, so
 * the very next dispatch pass re-asked it — up to five times a minute for hours.
 * That burned the broker API budget on a question whose answer could not have
 * changed yet, and it put a permanently-hot row at the head of the queue where it
 * starved every other owner's orders.
 *
 * The delay is a function of the refusal and the attempt count ONLY. It never
 * relaxes a gate and never extends the owner's automatic-order window: a retry
 * scheduled past the window is not worth keeping, which is what
 * {@link retryWorthKeeping} decides.
 */
import { type RejectReason } from "./execution";

/** First wait, and the growth factor and ceiling of the exponential schedule. */
export const BACKOFF_BASE_SECONDS = 60;
export const BACKOFF_FACTOR = 2;
export const BACKOFF_CEILING_SECONDS = 900;

/**
 * Refusals whose answer cannot plausibly change on a minute scale get their own
 * floor. A closed market does not reopen in sixty seconds, so re-asking at the
 * generic base rate is pure waste; it is asked at a slow, steady beat instead.
 */
const REASON_FLOOR_SECONDS: Partial<Record<RejectReason, number>> = {
  market_closed: 600,
};

/**
 * Seconds to wait before re-asking a delivery that was just refused.
 *
 * `attempts` is the number of attempts ALREADY spent (the claim increments it
 * before the gates run), so the first refusal produces the base wait.
 */
export function backoffSeconds(reason: string, attempts: number): number {
  const key = (reason.split(":")[0]?.trim() ?? "") as RejectReason;
  const spent = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
  const exponent = Math.max(0, spent - 1);
  const grown = BACKOFF_BASE_SECONDS * Math.pow(BACKOFF_FACTOR, Math.min(exponent, 20));
  const floor = REASON_FLOOR_SECONDS[key] ?? 0;
  return Math.min(BACKOFF_CEILING_SECONDS, Math.max(floor, grown));
}

/** The instant a refused delivery becomes claimable again. */
export function nextAttemptAt(reason: string, attempts: number, now: Date): Date {
  return new Date(now.getTime() + backoffSeconds(reason, attempts) * 1000);
}

/**
 * Whether re-queueing is still worth a row.
 *
 * When the next attempt would land after the owner's automatic-order window has
 * elapsed, the retry could only ever produce a terminal `tif_expired`. Settling
 * now is both cheaper and more honest than parking the row to expire silently.
 */
export function retryWorthKeeping(next: Date, deadline: Date | null): boolean {
  return deadline === null || next.getTime() < deadline.getTime();
}
