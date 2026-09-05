/**
 * Truthful classification of engine failure text.
 *
 * ZERO-HALLUCINATION: the classifier only reads the error string the engine
 * already stored. It never invents a cause, and it never converts "we could not
 * fetch data" into "there was nothing to trade" — a data-source refusal means
 * results are MISSING, not empty.
 */
export type EngineErrorKind =
  | "none"
  | "provider_access"
  | "provider_rate_limit"
  | "provider"
  | "engine";

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

const RATE_LIMIT_PATTERNS = [
  /TooManyRequestsError/i,
  /ToManyRequestsError/i,
  /\b429\b/,
  /too many (?:concurrent )?(?:requests|historical)/i,
  /concurrent historical market data requests/i,
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

  if (RATE_LIMIT_PATTERNS.some((re) => re.test(text))) {
    return {
      kind: "provider_rate_limit",
      label: "throttled by the broker data provider",
      explanation:
        "The provider capped concurrent market-data requests, so those candle reads were refused or timed out. The affected cycles produced no evaluation — missing data, not an absence of setups — and the next pass retries after the provider's wait.",
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
  /**
   * True while the FX weekend closure (Friday 21:00 → Sunday 21:00 UTC) is in
   * effect. During the closure the scanner deliberately enqueues no cycles, so
   * an empty window is a scheduled pause, not a silent engine.
   */
  weekendClosed?: boolean;
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
    if (scan.weekendClosed) {
      return {
        state: "no_cycles",
        value: "WEEKEND — PAUSED",
        tone: "good",
        errorIsCurrent: false,
      };
    }
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

export type ReplayHealthState =
  | "no_runs"
  | "tripped"
  | "degraded"
  | "recovering"
  | "running";


export interface ReplayBreakerInput {
  paused?: boolean | null;
  consecutive_failures?: number | null;
  last_error?: string | null;
  last_run_at?: string | null;
}

export interface ReplayHealth {
  state: ReplayHealthState;
  value: string;
  tone: "good" | "warn" | "bad";
  errorIsCurrent: boolean;
}

/**
 * Health of the replay/statistics engine breaker.
 *
 * A non-paused breaker with recent failures is not healthy: replay is still
 * allowed to try the next pass, but the last available result is degraded.
 */
/** A single failed pass is tolerated before the engine reads DEGRADED. */
export const REPLAY_DEGRADED_MIN_FAILURES = 1;

export function classifyReplayHealth(breaker: ReplayBreakerInput | null | undefined): ReplayHealth {
  if (!breaker?.last_run_at) {
    return { state: "no_runs", value: "NO RUNS", tone: "warn", errorIsCurrent: false };
  }
  if (breaker.paused) {
    return { state: "tripped", value: "BREAKER TRIPPED", tone: "bad", errorIsCurrent: true };
  }
  const failures = breaker.consecutive_failures ?? 0;
  // One throttled or failed pass is normal and self-correcting: the engine keeps
  // running and the next pass usually succeeds. Only a repeated failure
  // describes a degraded engine. The single-failure case is still reported
  // honestly as RECOVERING with its stored error current.
  if (failures > REPLAY_DEGRADED_MIN_FAILURES) {
    return { state: "degraded", value: "DEGRADED", tone: "warn", errorIsCurrent: true };
  }
  if (failures > 0 || Boolean((breaker.last_error ?? "").trim())) {
    return { state: "recovering", value: "RECOVERING", tone: "warn", errorIsCurrent: true };
  }
  return { state: "running", value: "RUNNING", tone: "good", errorIsCurrent: false };
}

