/**
 * News ingestion runtime.
 *
 * One run = one provider, one window, one ledger row. The ledger is written even
 * when the provider fails, because "we tried and were refused" is the fact that
 * keeps coverage honest — an absent run row must never look like an empty calendar.
 *
 * Writes are idempotent on `(provider, provider_event_key)`:
 *   - unseen key            -> insert + revision 0
 *   - same checksum         -> duplicate, nothing written
 *   - different checksum    -> revision N+1 + append-only revision row
 */
import { correlationGroupsFor, eventChecksum, instrumentsForEvent } from "./identity";
import { computeCoverage, type CoverageScope, type CoverageSnapshot } from "./coverage";
import { safeNote } from "./redact";
import {
  batchStatusIsHealthy,
  type EconomicEventProvider,
  type NormalizedEvent,
  type ProviderEventBatch,
} from "./types";

export const NEWS_WORKER_VERSION = "news-ingest-1";
/** Consecutive failed runs after which a provider is skipped for the cool-down. */
export const BREAKER_FAILURE_THRESHOLD = 5;
export const BREAKER_COOLDOWN_MS = 30 * 60_000;

/** Coverage states the DB CHECK constraint accepts. `unproven` is stored as `unknown`. */
function persistableCoverageState(state: CoverageSnapshot["state"]): string {
  return state === "unproven" ? "unknown" : state;
}

/**
 * The news tables are service-role only and are not part of the generated typed
 * schema surface used by the app, so this narrow structural type is what the
 * ingestion worker needs from the admin client — nothing more.
 */
interface MinimalClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface IngestionResult {
  provider: string;
  job: string;
  batchStatus: string;
  eventsReceived: number;
  inserts: number;
  updates: number;
  duplicates: number;
  revisions: number;
  invalidEvents: number;
  coverageWritten: number;
  skippedByBreaker: boolean;
  errorClass: string | null;
  errorNote: string | null;
}

function changeKind(previous: EventRow, next: NormalizedEvent): string {
  if (next.status === "cancelled") return "cancelled";
  if (next.status === "postponed") return "postponed";
  const scheduleChanged =
    (previous.scheduled_at ?? null) !== (next.scheduledAt ?? null) ||
    (previous.scheduled_date ?? null) !== (next.scheduledDate ?? null);
  if (scheduleChanged) return "schedule_change";
  if (
    previous.actual_value !== null &&
    next.actual !== null &&
    Number(previous.actual_value) !== next.actual
  ) {
    return "value_revision";
  }
  if (previous.event_status !== next.status) return "status_change";
  return "republished";
}

interface EventRow {
  id: string;
  provider_event_key: string;
  revision: number;
  payload_checksum: string;
  scheduled_at: string | null;
  scheduled_date: string | null;
  actual_value: number | null;
  event_status: string;
}

/** Has this provider tripped its breaker? Derived from the ledger, not memory. */
export async function breakerTripped(
  db: MinimalClient,
  provider: string,
  nowMs: number,
): Promise<boolean> {
  const { data } = await db
    .from("news_ingestion_runs")
    .select("batch_status, started_at")
    .eq("provider", provider)
    .gte("started_at", new Date(nowMs - BREAKER_COOLDOWN_MS).toISOString())
    .order("started_at", { ascending: false })
    .limit(BREAKER_FAILURE_THRESHOLD);
  const rows = (data ?? []) as { batch_status: string }[];
  if (rows.length < BREAKER_FAILURE_THRESHOLD) return false;
  return rows.every((row) => !batchStatusIsHealthy(row.batch_status as never));
}

async function persistEvents(
  db: MinimalClient,
  batch: ProviderEventBatch,
): Promise<{
  inserts: number;
  updates: number;
  duplicates: number;
  revisions: number;
  invalid: number;
}> {
  let inserts = 0;
  let updates = 0;
  let duplicates = 0;
  let revisions = 0;
  let invalid = 0;

  const keys = batch.events.map((e) => e.providerEventKey);
  const existing = new Map<string, EventRow>();
  if (keys.length > 0) {
    const { data } = await db
      .from("economic_events")
      .select(
        "id, provider_event_key, revision, payload_checksum, scheduled_at, scheduled_date, actual_value, event_status",
      )
      .eq("provider", batch.providerId)
      .in("provider_event_key", keys);
    for (const row of (data ?? []) as EventRow[]) existing.set(row.provider_event_key, row);
  }

  for (const event of batch.events) {
    if (!event.scheduledAt && !event.scheduledDate) {
      invalid += 1;
      continue;
    }
    if (event.timestampPrecision === "exact" && !event.scheduledAt) {
      // An "exact" claim without an instant is a contradiction: refuse it rather
      // than store a precision we cannot back.
      invalid += 1;
      continue;
    }

    const checksum = eventChecksum(event);
    const instruments = instrumentsForEvent({ family: event.family, currencies: event.currencies });
    const shared = {
      provider: batch.providerId,
      provider_event_key: event.providerEventKey,
      canonical_event_id: event.canonicalEventId,
      event_family: event.family,
      countries: event.countries,
      currencies: event.currencies,
      affected_instruments: instruments,
      affected_correlation_groups: correlationGroupsFor(instruments),
      importance: event.importance,
      scheduled_at: event.scheduledAt,
      scheduled_date: event.scheduledDate,
      original_scheduled_at: event.originalScheduledAt ?? event.scheduledAt,
      actual_published_at: event.actualPublishedAt ?? null,
      timestamp_precision: event.timestampPrecision,
      event_status: event.status,
      actual_value: event.actual,
      forecast_value: event.forecast,
      previous_value: event.previous,
      units: event.units,
      provider_updated_at: event.providerUpdatedAt,
      source_version: batch.sourceVersion,
      mapping_version: batch.mappingVersion,
      payload_checksum: checksum,
      field_provenance: event.fieldProvenance,
      diagnostics: event.diagnostics,
    };

    const previous = existing.get(event.providerEventKey);
    if (!previous) {
      const { data, error } = await db
        .from("economic_events")
        .insert({ ...shared, revision: 0 })
        .select("id")
        .single();
      if (error) {
        invalid += 1;
        continue;
      }
      inserts += 1;
      await db.from("economic_event_revisions").insert({
        event_id: (data as { id: string }).id,
        revision: 0,
        change_kind: "insert",
        scheduled_at: event.scheduledAt,
        scheduled_date: event.scheduledDate,
        actual_published_at: event.actualPublishedAt ?? null,
        event_status: event.status,
        actual_value: event.actual,
        forecast_value: event.forecast,
        previous_value: event.previous,
        timestamp_precision: event.timestampPrecision,
        provider_updated_at: event.providerUpdatedAt,
        source_version: batch.sourceVersion,
        mapping_version: batch.mappingVersion,
        payload_checksum: checksum,
        diagnostics: event.diagnostics,
      });
      continue;
    }

    if (previous.payload_checksum === checksum) {
      duplicates += 1;
      continue;
    }

    const nextRevision = previous.revision + 1;
    const kind = changeKind(previous, event);
    const { error } = await db
      .from("economic_events")
      .update({ ...shared, revision: nextRevision })
      .eq("id", previous.id);
    if (error) {
      invalid += 1;
      continue;
    }
    updates += 1;
    revisions += 1;
    await db.from("economic_event_revisions").insert({
      event_id: previous.id,
      revision: nextRevision,
      change_kind: kind,
      scheduled_at: event.scheduledAt,
      scheduled_date: event.scheduledDate,
      actual_published_at: event.actualPublishedAt ?? null,
      event_status: event.status,
      actual_value: event.actual,
      forecast_value: event.forecast,
      previous_value: event.previous,
      timestamp_precision: event.timestampPrecision,
      provider_updated_at: event.providerUpdatedAt,
      source_version: batch.sourceVersion,
      mapping_version: batch.mappingVersion,
      payload_checksum: checksum,
      diagnostics: event.diagnostics,
    });
  }

  return { inserts, updates, duplicates, revisions, invalid };
}

/** Run one provider over one window and record everything it proved. */
export async function runNewsIngestion(input: {
  db: MinimalClient;
  provider: EconomicEventProvider;
  job: string;
  from: string;
  to: string;
  scopes: CoverageScope[];
  nowMs?: number;
  lastSuccessAt?: string | null;
}): Promise<IngestionResult> {
  const nowMs = input.nowMs ?? Date.now();
  const startedAt = new Date(nowMs).toISOString();
  const base: IngestionResult = {
    provider: input.provider.providerId,
    job: input.job,
    batchStatus: "unknown",
    eventsReceived: 0,
    inserts: 0,
    updates: 0,
    duplicates: 0,
    revisions: 0,
    invalidEvents: 0,
    coverageWritten: 0,
    skippedByBreaker: false,
    errorClass: null,
    errorNote: null,
  };

  if (await breakerTripped(input.db, input.provider.providerId, nowMs)) {
    return { ...base, batchStatus: "outage", skippedByBreaker: true, errorClass: "breaker_open" };
  }

  let batch: ProviderEventBatch;
  try {
    batch = await input.provider.fetchEvents({ from: input.from, to: input.to });
  } catch (error) {
    batch = {
      providerId: input.provider.providerId,
      sourceVersion: input.provider.sourceVersion,
      mappingVersion: input.provider.mappingVersion,
      status: "outage",
      events: [],
      unsupported: [],
      requestCount: 1,
      retryCount: 0,
      responseStatus: null,
      errorClass: "adapter_threw",
      errorNote: safeNote(error, [process.env["FRED_API_KEY"], process.env["EIA_API_KEY"]]),
      cursor: null,
      staleAsOf: null,
    };
  }

  const persisted = batchStatusIsHealthy(batch.status)
    ? await persistEvents(input.db, batch)
    : { inserts: 0, updates: 0, duplicates: 0, revisions: 0, invalid: 0 };

  const coverage = computeCoverage({
    provider: batch.providerId,
    batchStatus: batch.status,
    requestedScopes: input.scopes,
    unsupported: batch.unsupported,
    events: batch.events,
  });

  if (coverage.length > 0) {
    await input.db.from("news_coverage_snapshots").insert(
      coverage.map((snapshot) => ({
        provider: snapshot.provider,
        country: null,
        currency: snapshot.currency,
        event_family: snapshot.family,
        coverage_state: persistableCoverageState(snapshot.state),
        scheduled_events: snapshot.eventCount,
        events_with_exact_time: snapshot.exactTimestampCount,
        latest_event_at: snapshot.lastEventAt
          ? new Date(`${snapshot.lastEventAt.slice(0, 10)}T00:00:00Z`).toISOString()
          : null,
        last_successful_run_at: batchStatusIsHealthy(batch.status)
          ? startedAt
          : (input.lastSuccessAt ?? null),
        freshness_seconds: null,
        source_version: batch.sourceVersion,
        mapping_version: batch.mappingVersion,
        note: snapshot.note,
      })),
    );
  }

  const completedMs = Date.now();
  await input.db.from("news_ingestion_runs").insert({
    provider: batch.providerId,
    job: input.job,
    started_at: startedAt,
    completed_at: new Date(completedMs).toISOString(),
    window_from: new Date(`${input.from}T00:00:00Z`).toISOString(),
    window_to: new Date(`${input.to}T00:00:00Z`).toISOString(),
    batch_status: batch.status,
    events_received: batch.events.length,
    inserts: persisted.inserts,
    updates: persisted.updates,
    duplicates: persisted.duplicates,
    revisions: persisted.revisions,
    invalid_events: persisted.invalid,
    request_count: batch.requestCount,
    retry_count: batch.retryCount,
    response_status: batch.responseStatus,
    duration_ms: Math.max(0, completedMs - nowMs),
    error_class: batch.errorClass,
    error_note: batch.errorNote,
    worker_version: NEWS_WORKER_VERSION,
  });

  return {
    ...base,
    batchStatus: batch.status,
    eventsReceived: batch.events.length,
    inserts: persisted.inserts,
    updates: persisted.updates,
    duplicates: persisted.duplicates,
    revisions: persisted.revisions,
    invalidEvents: persisted.invalid,
    coverageWritten: coverage.length,
    errorClass: batch.errorClass,
    errorNote: batch.errorNote,
  };
}
