/**
 * The correlated-cluster brake: how much of the SAME bet one account may hold.
 *
 * WHY. On 2026-09-09 an account took seven separate XAUUSD short setups inside
 * half an hour. None of them was a duplicate — every one had its own planned
 * entry, so duplicate prevention correctly stayed silent — but they were all the
 * same bet. Gold rose and every one lost about 1R. The existing ceilings count
 * orders (all instruments together, or per instrument per DAY); nothing said
 * "you already have a Gold short working, don't open another".
 *
 * WHAT this is. Two pure, reduce-only refusals evaluated at order time:
 *
 * 1. `sameBetCount` vs the owner's limit — how many UNRESOLVED automatic orders
 *    are already live on the same instrument in the same direction. Default 1,
 *    raisable to 2 or 3. There is no "off": stacking the same bet without any
 *    limit is what produced the loss cluster.
 * 2. `sameBetCooldown` — after a BROKER-CONFIRMED closed loss on that instrument
 *    and direction, refuse new automatic orders there for a short window.
 *
 * Both fail CLOSED towards allowing the order: an unreadable instrument or
 * direction is never counted and never starts a cool-off, because a refusal must
 * be based on a fact we actually hold. Neither rule touches an existing broker
 * order or position — they only refuse NEW orders.
 */

export const SAME_BET_LIMIT_MIN = 1;
export const SAME_BET_LIMIT_MAX = 3;
export const SAME_BET_LIMIT_DEFAULT = 1;

/** Minutes offered for the same-bet cool-off. 0 = off. */
export const SAME_BET_COOLDOWN_CHOICES = [0, 30, 60, 120] as const;
export const SAME_BET_COOLDOWN_DEFAULT_MINUTES = 60;

/**
 * Live same-bet limit (1–3). An absent or unreadable value yields the default of
 * 1 — never 0, which would be "no automatic orders", and never above 3.
 */
export function clampSameBetLimit(value: unknown): number {
  if (value === null || value === undefined || value === "") return SAME_BET_LIMIT_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return SAME_BET_LIMIT_DEFAULT;
  return Math.min(Math.max(Math.round(n), SAME_BET_LIMIT_MIN), SAME_BET_LIMIT_MAX);
}

/**
 * Cool-off minutes. Only the offered choices are legal; anything else falls back
 * to the default, so a stray value can never become an unbounded pause.
 */
export function clampSameBetCooldownMinutes(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return SAME_BET_COOLDOWN_DEFAULT_MINUTES;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return SAME_BET_COOLDOWN_DEFAULT_MINUTES;
  const rounded = Math.round(n);
  return (SAME_BET_COOLDOWN_CHOICES as readonly number[]).includes(rounded)
    ? rounded
    : SAME_BET_COOLDOWN_DEFAULT_MINUTES;
}

export interface SameBetRef {
  instrument: string | null;
  direction: string | null;
}

export function normaliseInstrument(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normaliseDirection(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().toLowerCase();
  return trimmed === "long" || trimmed === "short" ? trimmed : null;
}

/** True when both refs name the same instrument AND the same direction. */
export function isSameBet(a: SameBetRef, b: SameBetRef): boolean {
  const ai = normaliseInstrument(a.instrument);
  const bi = normaliseInstrument(b.instrument);
  const ad = normaliseDirection(a.direction);
  const bd = normaliseDirection(b.direction);
  if (!ai || !bi || !ad || !bd) return false;
  return ai === bi && ad === bd;
}

/**
 * How many of the already-held orders are the same bet as `candidate`. Rows
 * whose instrument or direction cannot be read are not counted.
 */
export function sameBetCount(candidate: SameBetRef, held: readonly SameBetRef[]): number {
  let count = 0;
  for (const order of held) if (isSameBet(candidate, order)) count += 1;
  return count;
}

export interface SameBetLimitVerdict {
  /** True when a NEW order on this bet must be refused. */
  reached: boolean;
  count: number;
  limit: number;
  detail: string;
}

export function evaluateSameBetLimit(
  candidate: SameBetRef,
  held: readonly SameBetRef[],
  limitSetting: unknown,
): SameBetLimitVerdict {
  const limit = clampSameBetLimit(limitSetting);
  const count = sameBetCount(candidate, held);
  const instrument = normaliseInstrument(candidate.instrument);
  const direction = normaliseDirection(candidate.direction);
  const named =
    instrument && direction ? `${instrument} ${direction}` : "this instrument and direction";
  return {
    reached: count >= limit,
    count,
    limit,
    detail: `${count} unresolved automatic ${count === 1 ? "order" : "orders"} already live on ${named}, your same-bet limit is ${limit}`,
  };
}

export interface ClosedLoss extends SameBetRef {
  /** Broker-confirmed close time, epoch ms. */
  exitAtMs: number;
}

export interface SameBetCooldownVerdict {
  active: boolean;
  /** When the cool-off ends, epoch ms. `null` when not active. */
  resumesAtMs: number | null;
  minutes: number;
  detail: string | null;
}

/**
 * Cool-off after a broker-confirmed loss on the same bet. Only CLOSED, broker
 * confirmed losses may be passed in; a missing or unreadable close never starts
 * a cool-off, and 0 minutes means the owner switched it off.
 */
export function evaluateSameBetCooldown(
  candidate: SameBetRef,
  losses: readonly ClosedLoss[],
  nowMs: number,
  minutesSetting: unknown,
): SameBetCooldownVerdict {
  const minutes = clampSameBetCooldownMinutes(minutesSetting);
  if (minutes <= 0) return { active: false, resumesAtMs: null, minutes, detail: null };
  let latest: number | null = null;
  for (const loss of losses) {
    if (!Number.isFinite(loss.exitAtMs)) continue;
    if (!isSameBet(candidate, loss)) continue;
    if (latest === null || loss.exitAtMs > latest) latest = loss.exitAtMs;
  }
  if (latest === null) return { active: false, resumesAtMs: null, minutes, detail: null };
  const resumesAtMs = latest + minutes * 60_000;
  if (resumesAtMs <= nowMs) return { active: false, resumesAtMs: null, minutes, detail: null };
  const instrument = normaliseInstrument(candidate.instrument);
  const direction = normaliseDirection(candidate.direction);
  const named =
    instrument && direction ? `${instrument} ${direction}` : "this instrument and direction";
  const remaining = Math.max(1, Math.round((resumesAtMs - nowMs) / 60_000));
  return {
    active: true,
    resumesAtMs,
    minutes,
    detail: `${named} is cooling off after a broker-confirmed loss; your ${minutes}-minute cool-off resumes in ${remaining} min`,
  };
}
