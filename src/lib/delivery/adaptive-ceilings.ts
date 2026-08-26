/**
 * Freshness-adaptive automatic-order ceilings, as pure rules.
 *
 * The ceilings that bound automatic orders are the owner's numbers. This module
 * only decides WHICH of the owner's numbers is in force right now, based on how
 * fresh the broker facts an order would be sized from actually are:
 *
 *  - `healthy`  — the armed account's equity observation (and, when known, the
 *    destination quote) are recent, so the owner's adaptive maximum applies.
 *  - `degraded` — a reading exists but is too old to be trusted for extra room,
 *    so the owner's adaptive floor applies.
 *  - `unknown`  — no readable observation at all. Treated exactly like
 *    `degraded`: absence of evidence is never room to trade more.
 *
 * Adaptive mode is opt-in. When it is off, the fixed ceilings apply unchanged.
 * Nothing here can authorise an order, change sizing, or widen any safety gate:
 * a ceiling can only ever refuse.
 *
 * Pure: no clock of its own, no I/O.
 */
import { BROKER_EQUITY_MAX_AGE_MS } from "@/lib/execution/equity-freshness";
import { REVALIDATION_QUOTE_MAX_AGE_MS } from "./execution";

export type FreshnessHealth = "healthy" | "degraded" | "unknown";

/**
 * Equity age at which extra order room is no longer granted.
 *
 * Half of {@link BROKER_EQUITY_MAX_AGE_MS}: an observation older than this is
 * still usable for sizing, but it is not evidence of a healthy data feed, so it
 * does not buy additional throughput.
 */
export const HEALTHY_EQUITY_MAX_AGE_MS = BROKER_EQUITY_MAX_AGE_MS / 2;

/** Quote age at which the feed stops counting as healthy, when a quote is known. */
export const HEALTHY_QUOTE_MAX_AGE_MS = REVALIDATION_QUOTE_MAX_AGE_MS;

export interface FreshnessInput {
  /** Broker-reported equity observation time for the armed account. */
  equityObservedAt?: string | null;
  /**
   * Last known destination quote time, when one is available. Absent means "not
   * measured here" and does not by itself degrade the reading — the equity
   * observation is the required signal.
   */
  quoteObservedAt?: string | null;
  now: number;
}

export interface FreshnessVerdict {
  health: FreshnessHealth;
  /** Age of the equity observation in ms, when readable. */
  equityAgeMs: number | null;
  detail: string;
}

function ageOf(at: string | null | undefined, now: number): number | null {
  if (!at) return null;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  const age = now - ms;
  // A timestamp from the future is not fresh, it is unusable.
  if (age < -60_000) return null;
  return Math.max(age, 0);
}

/** How trustworthy are the broker facts behind this owner's orders right now? */
export function assessFreshness(input: FreshnessInput): FreshnessVerdict {
  const equityAgeMs = ageOf(input.equityObservedAt, input.now);
  if (equityAgeMs === null) {
    return {
      health: "unknown",
      equityAgeMs: null,
      detail: "no readable broker equity observation",
    };
  }
  if (equityAgeMs > HEALTHY_EQUITY_MAX_AGE_MS) {
    return {
      health: "degraded",
      equityAgeMs,
      detail: `broker equity observed ${Math.round(equityAgeMs / 1000)}s ago`,
    };
  }
  const quoteAgeMs = ageOf(input.quoteObservedAt, input.now);
  if (input.quoteObservedAt && quoteAgeMs === null) {
    return { health: "degraded", equityAgeMs, detail: "the last quote time could not be read" };
  }
  if (quoteAgeMs !== null && quoteAgeMs > HEALTHY_QUOTE_MAX_AGE_MS) {
    return {
      health: "degraded",
      equityAgeMs,
      detail: `last quote ${Math.round(quoteAgeMs / 1000)}s old`,
    };
  }
  return {
    health: "healthy",
    equityAgeMs,
    detail: `broker equity observed ${Math.round(equityAgeMs / 1000)}s ago`,
  };
}

export interface CeilingInput {
  /** The owner's fixed daily ceiling (already clamped). */
  dailyBase: number;
  /** The owner's fixed per-symbol daily ceiling (already clamped). */
  perSymbolBase: number;
  adaptiveEnabled: boolean;
  /** Owner's adaptive upper bound (already clamped). */
  adaptiveMax: number;
  /** Owner's adaptive lower bound (already clamped). */
  adaptiveFloor: number;
  health: FreshnessHealth;
}

export interface EffectiveCeilings {
  daily: number;
  perSymbol: number;
  health: FreshnessHealth;
  /** `fixed` when adaptive mode is off, otherwise which side of the band applied. */
  applied: "fixed" | "adaptive_raised" | "adaptive_reduced";
}

/**
 * The ceilings in force for this decision.
 *
 * Healthy raises TOWARDS the owner's adaptive maximum, never past it and never
 * below the fixed base. Degraded and unknown reduce TOWARDS the owner's adaptive
 * floor, never above the fixed base. A base of 0 means the owner switched that
 * ceiling off and stays 0 in every direction.
 */
export function effectiveCeilings(input: CeilingInput): EffectiveCeilings {
  const {
    dailyBase,
    perSymbolBase,
    adaptiveEnabled,
    adaptiveMax,
    adaptiveFloor,
    health,
  } = input;
  if (!adaptiveEnabled) {
    return { daily: dailyBase, perSymbol: perSymbolBase, health, applied: "fixed" };
  }
  if (health === "healthy") {
    const raise = (base: number) => (base === 0 ? 0 : Math.max(base, Math.min(adaptiveMax, 25)));
    return {
      daily: raise(dailyBase),
      perSymbol: raise(perSymbolBase),
      health,
      applied: "adaptive_raised",
    };
  }
  const reduce = (base: number) => (base === 0 ? 0 : Math.min(base, adaptiveFloor));
  return {
    daily: reduce(dailyBase),
    perSymbol: reduce(perSymbolBase),
    health,
    applied: "adaptive_reduced",
  };
}

/** One-line, user-readable description of the ceiling in force. */
export function describeCeilings(c: EffectiveCeilings, detail: string): string {
  const mode =
    c.applied === "fixed"
      ? "fixed limits"
      : c.applied === "adaptive_raised"
        ? "adaptive limits raised (broker data fresh)"
        : "adaptive limits reduced (broker data not fresh)";
  return `${mode}: ${c.daily}/day, ${c.perSymbol}/day per instrument — ${detail}`;
}
