/**
 * Truthful classification of engine failure text.
 *
 * ZERO-HALLUCINATION: the classifier only reads the error string the engine
 * already stored. It never invents a cause, and it never converts "we could not
 * fetch data" into "there was nothing to trade" — a data-source refusal means
 * results are MISSING, not empty.
 */
export type EngineErrorKind =
  "none" | "provider_access" | "provider_rate_limit" | "provider" | "engine";

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

export type ReplayHealthState = "no_runs" | "tripped" | "degraded" | "recovering" | "running";

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

/**
 * Starvation of the scanner: jobs discarded before any candle was fetched.
 *
 * A job older than the freshness limit is closed as `stale` without analysis —
 * correct behaviour on its own, but when it becomes the NORM the engine is
 * publishing nothing while every other counter still reads "done". This is the
 * state that hid a seven-hour outage: 36 done jobs an hour, zero analysis.
 *
 * Nothing is inferred beyond the counters: `stale` and `analysed` are recorded
 * outcomes, and a starved verdict never claims the market had no setups.
 */
export type ScanStarvationState = "idle" | "healthy" | "partial" | "starved";

export interface ScanStarvationInput {
  total: number;
  stale: number;
  analysed: number;
  last_analysed_at?: string | null;
  last_candle_fetch_at?: string | null;
  weekendClosed?: boolean;
}

export interface ScanStarvation {
  state: ScanStarvationState;
  value: string;
  tone: "good" | "warn" | "bad";
  /** Share of finished jobs discarded before analysis, 0..1. */
  staleShare: number;
  /** True when the engine is producing no analysis at all right now. */
  isFault: boolean;
}

/** Above this share of discarded jobs the engine is treated as starved. */
export const STALE_SHARE_FAULT = 0.25;

export function classifyScanStarvation(input: ScanStarvationInput): ScanStarvation {
  const finished = input.stale + input.analysed;
  const share = finished > 0 ? input.stale / finished : 0;

  if (finished === 0) {
    return {
      state: "idle",
      value: input.weekendClosed ? "WEEKEND — PAUSED" : "NO JOBS FINISHED",
      tone: input.weekendClosed ? "good" : "warn",
      staleShare: 0,
      isFault: false,
    };
  }

  if (input.analysed === 0) {
    return {
      state: "starved",
      value: "NOT ANALYSING",
      tone: "bad",
      staleShare: share,
      isFault: true,
    };
  }

  if (share > STALE_SHARE_FAULT) {
    return {
      state: "partial",
      value: "WORK DISCARDED",
      tone: "warn",
      staleShare: share,
      isFault: true,
    };
  }

  return { state: "healthy", value: "ANALYSING", tone: "good", staleShare: share, isFault: false };
}

/**
 * Health of the database -> app scheduled-call link. `failed` counts non-2xx
 * responses and outright timeouts sampled from the platform's own HTTP log, so
 * a broken link is a measured fact rather than an inference from queue lag.
 *
 * The two named causes are counted apart because they need different answers: a
 * name-lookup stall is upstream and outside our control, while a plain timeout
 * points at our own handler outstaying the caller's patience. Neither is ever
 * inferred — an unclassified failure stays unclassified.
 */
export interface LinkHealthInput {
  ok: number;
  failed: number;
  /** Failures that timed out with the time spent outside name resolution. */
  failed_timeout?: number | null;
  /**
   * Failures whose elapsed time was spent in DNS: an upstream name-lookup
   * stall. The sampler only counts a timeout here when name resolution
   * consumed ~all of the allowed time — a 1ms lookup inside a 20s hang is our
   * own slowness, not DNS.
   */
  failed_dns?: number | null;
  /**
   * Failures where the app answered 5xx or the platform cancelled a hung
   * request (502). Our own fault, counted apart from timeouts.
   */
  failed_5xx?: number | null;
  last_sampled_at?: string | null;
}

export interface LinkHealth {
  value: string;
  tone: "good" | "warn" | "bad";
  failShare: number;
  /** No samples yet: the sampler has not run, so nothing is known. */
  unmeasured: boolean;
  /**
   * The larger measured cause, or `null` when no failure was classified. Never a
   * guess: a failure the sampler could not attribute leaves this null.
   */
  dominantCause: "timeout" | "dns" | "server_error" | null;
  /** Plain-language cause, empty when nothing was classified. */
  causeLabel: string;
}

export function classifyLinkHealth(input: LinkHealthInput | null | undefined): LinkHealth {
  const ok = input?.ok ?? 0;
  const failed = input?.failed ?? 0;
  const total = ok + failed;
  if (!input || total === 0) {
    return {
      value: "NOT MEASURED YET",
      tone: "warn",
      failShare: 0,
      unmeasured: true,
      dominantCause: null,
      causeLabel: "",
    };
  }
  const timeouts = input.failed_timeout ?? 0;
  const dns = input.failed_dns ?? 0;
  const dominantCause: LinkHealth["dominantCause"] =
    timeouts === 0 && dns === 0 ? null : dns > timeouts ? "dns" : "timeout";
  const causeLabel =
    dominantCause === "dns"
      ? "mostly upstream name-lookup stalls"
      : dominantCause === "timeout"
        ? "mostly no answer inside the caller's window"
        : "";

  const share = failed / total;
  const base = { failShare: share, unmeasured: false, dominantCause, causeLabel };
  if (share >= 0.2) return { value: "FAILING", tone: "bad", ...base };
  if (failed > 0) return { value: "DEGRADED", tone: "warn", ...base };
  return {
    value: "OK",
    tone: "good",
    failShare: 0,
    unmeasured: false,
    dominantCause: null,
    causeLabel: "",
  };
}
