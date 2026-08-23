/**
 * Truthful classification of engine failure text.
 *
 * ZERO-HALLUCINATION: the classifier only reads the error string the engine
 * already stored. It never invents a cause, and it never converts "we could not
 * fetch data" into "there was nothing to trade" — a data-source refusal means
 * results are MISSING, not empty.
 */
export type EngineErrorKind = "none" | "provider_access" | "provider" | "engine";

export interface EngineErrorClassification {
  kind: EngineErrorKind;
  /** Short human label for a status tile. */
  label: string;
  /** One sentence explaining what the state does and does not mean. */
  explanation: string;
}

const PROVIDER_ACCESS_PATTERNS = [
  /top up your account/i,
  /payment required/i,
  /insufficient (?:funds|balance|credit)/i,
  /subscription (?:expired|required|inactive)/i,
  /quota (?:exceeded|exhausted)/i,
];

const PROVIDER_PATTERNS = [/metaapi/i, /candle/i, /\b(?:429|502|503|504)\b/, /ValidationError/];

export function classifyEngineError(error: string | null | undefined): EngineErrorClassification {
  const text = (error ?? "").trim();
  if (!text) {
    return {
      kind: "none",
      label: "no recent error",
      explanation: "No failure recorded on the last pass.",
    };
  }

  if (PROVIDER_ACCESS_PATTERNS.some((re) => re.test(text))) {
    return {
      kind: "provider_access",
      label: "market-data access refused by the broker data provider",
      explanation:
        "The data provider rejected the candle request for account/billing reasons. Scanner results for those cycles are missing, not empty — this is not a scanner-wide No Trade, and no substitute data is used.",
    };
  }

  if (PROVIDER_PATTERNS.some((re) => re.test(text))) {
    return {
      kind: "provider",
      label: "market-data fetch failed at the provider",
      explanation:
        "Candle retrieval failed upstream. Affected cycles produced no evaluation at all — missing data, not an absence of setups.",
    };
  }

  return {
    kind: "engine",
    label: "engine error",
    explanation: "The failure came from our own processing, not the data provider.",
  };
}

/** Human-readable remaining cooldown, or null when it has elapsed / is unset. */
export function cooldownRemaining(pausedUntil: string | null, now = Date.now()): string | null {
  if (!pausedUntil) return null;
  const at = Date.parse(pausedUntil);
  if (!Number.isFinite(at) || at <= now) return null;
  const mins = Math.ceil((at - now) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Health of the live 15-minute scanner over its rolling window.
 *
 * The window is rolling, so a failure inside it is NOT evidence that the
 * scanner is failing now. When the newest failure is older than the newest
 * success the incident has healed: we say RECOVERED and mark the stored error
 * as no longer current. Nothing is invented — every state is read off the
 * counters and timestamps the engine already recorded.
 */
export type ScanHealthState = "no_cycles" | "failing" | "degraded" | "recovered" | "running";

export interface ScanWindowInput {
  total: number;
  failed: number;
  succeeded: number;
  last_success_at?: string | null;
  last_failure_at?: string | null;
}

export interface ScanHealth {
  state: ScanHealthState;
  /** Label for the status tile. */
  value: string;
  tone: "good" | "warn" | "bad";
  /**
   * True when the stored failure text still describes the scanner's current
   * state. False once a successful cycle finished after the last failure.
   */
  errorIsCurrent: boolean;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

export function classifyScanHealth(scan: ScanWindowInput): ScanHealth {
  if (scan.total === 0) {
    return { state: "no_cycles", value: "NO CYCLES", tone: "warn", errorIsCurrent: false };
  }
  if (scan.failed === 0) {
    return { state: "running", value: "RUNNING", tone: "good", errorIsCurrent: false };
  }
  if (scan.failed === scan.total) {
    return { state: "failing", value: "FAILING", tone: "bad", errorIsCurrent: true };
  }

  const lastFailure = parseTime(scan.last_failure_at);
  const lastSuccess = parseTime(scan.last_success_at);
  const healed = lastSuccess !== null && (lastFailure === null || lastSuccess > lastFailure);

  return healed
    ? { state: "recovered", value: "RECOVERED", tone: "warn", errorIsCurrent: false }
    : { state: "degraded", value: "DEGRADED", tone: "warn", errorIsCurrent: true };
}

