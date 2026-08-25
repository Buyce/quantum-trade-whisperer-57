/**
 * Structure identity (Phase A2A, remediation R1-FIX).
 *
 * A structure key is the DUPLICATE-DETECTION IDENTITY of one ABC leg. It is not a
 * display string, and it must never depend on anything that can change underneath
 * the live data — including a broker's reported `digits`.
 *
 * Phase A1 briefly rendered the stop anchor at `priceDecimals(instrument)`. That
 * was a defect: every live XAUUSD row in `scanned_signals` carries a key with a
 * five-decimal stop anchor (`...|4649.93597`), so a two-decimal renderer
 * (`...|4649.94`) produces a key that can never match a stored one. The active
 * duplicate check and the `scanned_signals_active_structure` unique index would
 * both stop recognising a lingering Gold structure, and the same setup could be
 * republished on every 15-minute cycle.
 *
 * Identity is therefore FORMATTING-INDEPENDENT of broker specifications: version 1
 * always renders the stop anchor at a fixed five decimals, for every instrument in
 * every wave. Display and storage precision stay instrument-aware — see
 * `@/lib/instruments/precision` — they simply may not feed identity.
 *
 * Changing this rendering is a versioned migration, never an in-place edit:
 * bump `STRUCTURE_KEY_VERSION`, keep version 1 readable, and dual-read during any
 * transition. Live keys are pinned byte-for-byte by
 * `src/lib/scanner/__tests__/structure-key-parity.test.ts`.
 */

/** Identity schema version stamped into research provenance. */
export const STRUCTURE_KEY_VERSION = 1 as const;

/**
 * Decimals used to render the stop anchor inside a version-1 identity.
 *
 * Deliberately a constant and deliberately NOT `priceDecimals()`.
 */
export const STRUCTURE_KEY_STOP_DECIMALS = 5 as const;

export interface StructureKeyParts {
  instrument: string;
  direction: "long" | "short";
  aTime: string;
  bTime: string;
  stopLoss: number;
}

/** Build a version-1 structure key. */
export function buildStructureKey(parts: StructureKeyParts): string {
  return [
    parts.instrument,
    parts.direction,
    parts.aTime,
    parts.bTime,
    parts.stopLoss.toFixed(STRUCTURE_KEY_STOP_DECIMALS),
  ].join("|");
}

/**
 * Parse a version-1 key back into its parts, or null when it is not one.
 *
 * Used by parity tests and by diagnostics that need to explain an identity; never
 * used to make a trading decision.
 */
export function parseStructureKey(key: string): StructureKeyParts | null {
  const segments = key.split("|");
  if (segments.length !== 5) return null;
  const [instrument, direction, aTime, bTime, stop] = segments;
  if (!instrument || !aTime || !bTime || !stop) return null;
  if (direction !== "long" && direction !== "short") return null;
  const stopLoss = Number(stop);
  if (!Number.isFinite(stopLoss)) return null;
  return { instrument, direction, aTime, bTime, stopLoss };
}
