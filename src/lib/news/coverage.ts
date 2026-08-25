/**
 * Coverage calculation: what the ingested data actually proves.
 *
 * Coverage is scoped to (provider, currency, family) and is deliberately pessimistic.
 * A window with no events is only "healthy" when the provider itself answered
 * completely for that scope; anything else — a partial page, a throttle, a
 * date-only schedule — is reported as what it is, so the policy layer can fail
 * closed instead of reading silence as safety.
 */
import type { NewsFamily, NormalizedEvent, ProviderBatchStatus, UnsupportedScope } from "./types";
import { batchStatusIsHealthy } from "./types";

export const COVERAGE_VERSION = "news-coverage-1";

export type CoverageState =
  /** Provider answered completely; scheduled times are exact where present. */
  | "healthy"
  /** Provider answered, but only some pages/series succeeded. */
  | "partial"
  /** Provider answered, but publishes dates without an exact release time. */
  | "timestamp_incomplete"
  /** Provider has no data for this scope and never will. */
  | "unsupported"
  /** Provider failed (outage, throttle, auth, bad schema). */
  | "provider_error"
  /** Provider's own data is older than our freshness requirement. */
  | "stale"
  /** Never successfully observed. */
  | "unproven";

/** Coverage states that permit a NEW entry to be authorised by news policy. */
const CLEARING_STATES: readonly CoverageState[] = ["healthy"];

export function coverageClears(state: CoverageState): boolean {
  return CLEARING_STATES.includes(state);
}

/** Worst-of, so a single defective scope cannot be averaged away. */
const SEVERITY: Record<CoverageState, number> = {
  healthy: 0,
  timestamp_incomplete: 1,
  partial: 2,
  stale: 3,
  provider_error: 4,
  unsupported: 5,
  unproven: 6,
};

export function worstCoverage(states: CoverageState[]): CoverageState {
  if (states.length === 0) return "unproven";
  return states.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst), states[0]!);
}

export interface CoverageScope {
  currency: string;
  family: NewsFamily;
}

export interface CoverageSnapshot extends CoverageScope {
  provider: string;
  state: CoverageState;
  eventCount: number;
  exactTimestampCount: number;
  dateOnlyCount: number;
  /** Latest scheduled instant/date observed in the window, for staleness review. */
  lastEventAt: string | null;
  note: string;
}

export interface CoverageInput {
  provider: string;
  batchStatus: ProviderBatchStatus;
  /** Scopes the run was supposed to answer for. */
  requestedScopes: CoverageScope[];
  /** Scopes the provider structurally cannot answer for. */
  unsupported: UnsupportedScope[];
  events: NormalizedEvent[];
  /** Scopes the provider answered completely, when the adapter can be that specific. */
  provenScopes?: CoverageScope[];
}

function scopeKey(scope: CoverageScope): string {
  return `${scope.currency.toUpperCase()}|${scope.family}`;
}

/**
 * Derive one snapshot per requested scope.
 *
 * A scope is healthy only when the batch status is healthy, the adapter did not
 * declare it unsupported, and every event we did see for it carries an exact
 * timestamp. Date-only schedules downgrade the scope to `timestamp_incomplete`:
 * the schedule is real, but it cannot authorise an intraday suppression window.
 */
export function computeCoverage(input: CoverageInput): CoverageSnapshot[] {
  const unsupportedKeys = new Set<string>();
  for (const scope of input.unsupported) {
    for (const requested of input.requestedScopes) {
      const currencyMatch =
        !scope.currency || scope.currency.toUpperCase() === requested.currency.toUpperCase();
      const familyMatch = !scope.family || scope.family === requested.family;
      if (currencyMatch && familyMatch) unsupportedKeys.add(scopeKey(requested));
    }
  }
  const proven = input.provenScopes ? new Set(input.provenScopes.map(scopeKey)) : null;
  const healthyBatch = batchStatusIsHealthy(input.batchStatus);

  return input.requestedScopes.map((scope) => {
    const key = scopeKey(scope);
    const events = input.events.filter(
      (event) =>
        event.family === scope.family &&
        event.currencies.some((c) => c.toUpperCase() === scope.currency.toUpperCase()),
    );
    const exact = events.filter((e) => e.timestampPrecision === "exact").length;
    const dateOnly = events.filter((e) => e.timestampPrecision !== "exact").length;
    const lastEventAt =
      events
        .map((e) => e.scheduledAt ?? e.scheduledDate)
        .filter((v): v is string => typeof v === "string")
        .sort()
        .at(-1) ?? null;

    let state: CoverageState;
    let note: string;
    if (unsupportedKeys.has(key)) {
      state = "unsupported";
      note = `${input.provider} publishes no ${scope.family} data for ${scope.currency}`;
    } else if (!healthyBatch) {
      state = input.batchStatus === "stale" ? "stale" : mapFailure(input.batchStatus);
      note = `${input.provider} returned "${input.batchStatus}" for this window`;
    } else if (proven && !proven.has(key)) {
      state = "unproven";
      note = `${input.provider} did not confirm it answers for ${scope.currency} ${scope.family}`;
    } else if (dateOnly > 0) {
      state = "timestamp_incomplete";
      note = `${dateOnly} of ${events.length} events carry a release date without an exact time`;
    } else {
      state = "healthy";
      note =
        events.length === 0
          ? "provider answered completely; no events scheduled in this window"
          : `${events.length} events with exact release times`;
    }

    return {
      provider: input.provider,
      currency: scope.currency.toUpperCase(),
      family: scope.family,
      state,
      eventCount: events.length,
      exactTimestampCount: exact,
      dateOnlyCount: dateOnly,
      lastEventAt,
      note,
    };
  });
}

function mapFailure(status: ProviderBatchStatus): CoverageState {
  if (status === "partial") return "partial";
  return "provider_error";
}

/** Best (most complete) state across providers for the same scope. */
export function mergeProviderCoverage(snapshots: CoverageSnapshot[]): Map<string, CoverageState> {
  const out = new Map<string, CoverageState>();
  for (const snapshot of snapshots) {
    const key = scopeKey(snapshot);
    const current = out.get(key);
    if (current === undefined || SEVERITY[snapshot.state] < SEVERITY[current]) {
      out.set(key, snapshot.state);
    }
  }
  return out;
}

export { scopeKey };
