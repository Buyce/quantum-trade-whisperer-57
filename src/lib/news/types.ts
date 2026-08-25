/**
 * Provider-neutral economic-event contract.
 *
 * The point of this module is a single rule: an adapter may never turn incomplete
 * data into healthy coverage. Every way a fetch can be less than complete gets its
 * own status, so the ingestion ledger and the coverage calculation can tell
 * "nothing scheduled" apart from "the provider refused us".
 */
import type { NewsFamily } from "@/lib/instruments/news-risk";

export type { NewsFamily };

export type ProviderBatchStatus =
  /** Fetch succeeded and returned events. */
  | "ok"
  /** Fetch succeeded and the window genuinely contains no events. */
  | "empty"
  /** Some pages/series answered, others did not. Coverage is NOT healthy. */
  | "partial"
  /** Provider rate-limited us. */
  | "throttled"
  /** Provider unreachable, timed out, or 5xx. */
  | "outage"
  /** Credential missing, invalid or unauthorised for the endpoint. */
  | "authorization_error"
  /** Response parsed but did not match the documented schema. */
  | "invalid_response"
  /** Provider answered, but its own data is older than we require. */
  | "stale";

/** Only these two mean "the provider answered completely". */
export const HEALTHY_BATCH_STATUSES: readonly ProviderBatchStatus[] = ["ok", "empty"];

export function batchStatusIsHealthy(status: ProviderBatchStatus): boolean {
  return HEALTHY_BATCH_STATUSES.includes(status);
}

export type TimestampPrecision =
  /** Instant known to the minute, with timezone. Intraday suppression is possible. */
  | "exact"
  /** Calendar date only. Intraday suppression is NOT authorised by this event. */
  | "date_only"
  | "unknown";

export type EventStatus =
  "scheduled" | "published" | "revised" | "postponed" | "cancelled" | "unknown";

export type EventImportance = "high" | "medium" | "low" | "unknown";

/** A single normalised economic event, as known at one observation. */
export interface NormalizedEvent {
  /** Stable provider identity. Never a mutable title. */
  providerEventKey: string;
  /** Cross-provider identity for the same real-world release. */
  canonicalEventId: string;
  family: NewsFamily;
  countries: string[];
  currencies: string[];
  importance: EventImportance;
  /** Present only when an authoritative exact time exists. */
  scheduledAt: string | null;
  /** ISO date (UTC calendar day) when only a date is published. */
  scheduledDate: string | null;
  originalScheduledAt?: string | null;
  actualPublishedAt?: string | null;
  timestampPrecision: TimestampPrecision;
  status: EventStatus;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  units: string | null;
  providerUpdatedAt: string | null;
  /** Which source each notable field came from, e.g. `{ scheduledAt: "fred:release_dates" }`. */
  fieldProvenance: Record<string, string>;
  /** Bounded diagnostics only — never a raw provider payload. */
  diagnostics: Record<string, unknown>;
}

export interface UnsupportedScope {
  country?: string;
  currency?: string;
  family?: NewsFamily;
  note: string;
}

export interface ProviderEventBatch {
  providerId: string;
  sourceVersion: string;
  mappingVersion: string;
  status: ProviderBatchStatus;
  events: NormalizedEvent[];
  /** Scopes this provider structurally cannot answer for. */
  unsupported: UnsupportedScope[];
  requestCount: number;
  retryCount: number;
  responseStatus: number | null;
  errorClass: string | null;
  /** Redacted, bounded note. Never contains a URL with a credential. */
  errorNote: string | null;
  cursor: string | null;
  /** Set when `status === "stale"`: the provider's own as-of time. */
  staleAsOf: string | null;
}

export interface ProviderHealth {
  providerId: string;
  status: ProviderBatchStatus;
  credentialConfigured: boolean;
  requestCount: number;
  note: string | null;
}

export interface EconomicEventProvider {
  readonly providerId: string;
  readonly sourceVersion: string;
  readonly mappingVersion: string;
  fetchEvents(input: { from: string; to: string; cursor?: string }): Promise<ProviderEventBatch>;
  fetchUpdates?(input: { since: string; cursor?: string }): Promise<ProviderEventBatch>;
  health(): Promise<ProviderHealth>;
}

/** Empty batch helper so an adapter never has to hand-build a failure shape. */
export function emptyBatch(
  provider: Pick<EconomicEventProvider, "providerId" | "sourceVersion" | "mappingVersion">,
  status: ProviderBatchStatus,
  extra: Partial<ProviderEventBatch> = {},
): ProviderEventBatch {
  return {
    providerId: provider.providerId,
    sourceVersion: provider.sourceVersion,
    mappingVersion: provider.mappingVersion,
    status,
    events: [],
    unsupported: [],
    requestCount: 0,
    retryCount: 0,
    responseStatus: null,
    errorClass: null,
    errorNote: null,
    cursor: null,
    staleAsOf: null,
    ...extra,
  };
}
