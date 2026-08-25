/**
 * FRED (Federal Reserve Bank of St. Louis) release-schedule adapter.
 *
 * What this source CAN prove, verified against the live API:
 *   - which US statistical releases exist, with stable numeric release ids;
 *   - which calendar dates those releases are scheduled for, including future dates.
 *
 * What it CANNOT prove, and is therefore never invented here:
 *   - the exact intraday release time. `/fred/releases/dates` returns a bare
 *     calendar date, so every event is emitted with `timestampPrecision:
 *     "date_only"`, which downgrades coverage to `timestamp_incomplete` and, under
 *     the policy layer, refuses to authorise an intraday suppression window.
 *   - actual/forecast/previous values. Those live in the observations endpoints and
 *     are not requested by this adapter; the fields stay null rather than 0.
 *
 * The API key is only accepted as a query parameter, so every URL is a secret and
 * every diagnostic path goes through `redactUrl`/`safeNote`.
 */
import { canonicalEventId, providerEventKey } from "../identity";
import { safeNote } from "../redact";
import {
  emptyBatch,
  type EconomicEventProvider,
  type EventImportance,
  type NewsFamily,
  type NormalizedEvent,
  type ProviderEventBatch,
  type ProviderHealth,
  type UnsupportedScope,
} from "../types";

const BASE = "https://api.stlouisfed.org/fred";
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Allow-listed releases, each verified to exist on the live API.
 *
 * Only releases we can map to a news family and a currency are listed; FRED
 * publishes hundreds more, and an unmapped release must not be guessed into a
 * family.
 */
export interface FredReleaseMapping {
  releaseId: number;
  slug: string;
  label: string;
  family: NewsFamily;
  importance: EventImportance;
}

export const FRED_RELEASES: readonly FredReleaseMapping[] = [
  {
    releaseId: 10,
    slug: "us-cpi",
    label: "Consumer Price Index",
    family: "inflation",
    importance: "high",
  },
  {
    releaseId: 46,
    slug: "us-ppi",
    label: "Producer Price Index",
    family: "inflation",
    importance: "medium",
  },
  {
    releaseId: 50,
    slug: "us-employment-situation",
    label: "Employment Situation",
    family: "employment",
    importance: "high",
  },
  {
    releaseId: 180,
    slug: "us-jobless-claims",
    label: "Unemployment Insurance Weekly Claims",
    family: "employment",
    importance: "medium",
  },
  {
    releaseId: 101,
    slug: "us-fomc-statement",
    label: "FOMC Press Release",
    family: "central_bank",
    importance: "high",
  },
  {
    releaseId: 53,
    slug: "us-gdp",
    label: "Gross Domestic Product",
    family: "us_macro",
    importance: "high",
  },
  {
    releaseId: 54,
    slug: "us-personal-income-outlays",
    label: "Personal Income and Outlays",
    family: "us_macro",
    importance: "high",
  },
  {
    releaseId: 9,
    slug: "us-retail-sales",
    label: "Advance Retail Sales",
    family: "us_macro",
    importance: "high",
  },
  {
    releaseId: 13,
    slug: "us-industrial-production",
    label: "Industrial Production",
    family: "us_macro",
    importance: "medium",
  },
  {
    releaseId: 51,
    slug: "us-international-trade",
    label: "International Trade in Goods and Services",
    family: "us_macro",
    importance: "low",
  },
];

const RELEASE_BY_ID = new Map(FRED_RELEASES.map((r) => [r.releaseId, r]));

export const FRED_PROVIDER_ID = "fred";
export const FRED_SOURCE_VERSION = "fred-releases-dates-v1";
export const FRED_MAPPING_VERSION = "fred-map-1";

/**
 * FRED is a US source only. Declaring the rest explicitly is what keeps the
 * coverage calculation honest for GBP/JPY/AUD/CAD/CHF/EUR scopes.
 */
const NON_USD_CURRENCIES = ["EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"] as const;

export const FRED_UNSUPPORTED: readonly UnsupportedScope[] = [
  ...NON_USD_CURRENCIES.map((currency) => ({
    currency,
    note: "FRED publishes US releases only; this currency is not covered by this provider",
  })),
  {
    currency: "USD",
    family: "energy_inventory" as const,
    note: "energy inventory data comes from EIA, not FRED",
  },
  {
    currency: "USD",
    family: "opec_supply" as const,
    note: "OPEC publishes no machine-readable announcement feed",
  },
  {
    currency: "USD",
    family: "earnings_season" as const,
    note: "FRED publishes no equity earnings calendar",
  },
];

interface FredReleaseDate {
  release_id: number;
  release_name?: string;
  date: string;
}

function assertNonEmpty(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) throw new Error(`${name} is not configured`);
  return value;
}

async function getJson(
  path: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("api_key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { parseError: true };
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function normalise(row: FredReleaseDate): NormalizedEvent | null {
  const mapping = RELEASE_BY_ID.get(row.release_id);
  if (!mapping) return null;
  const date = row.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  return {
    providerEventKey: providerEventKey([FRED_PROVIDER_ID, "release", mapping.releaseId, date]),
    canonicalEventId: canonicalEventId({ scope: "USD", slug: mapping.slug, period: date }),
    family: mapping.family,
    countries: ["US"],
    currencies: ["USD"],
    importance: mapping.importance,
    // FRED publishes the release DATE. No exact instant exists in this response,
    // so none is fabricated.
    scheduledAt: null,
    scheduledDate: date,
    timestampPrecision: "date_only",
    status: "scheduled",
    actual: null,
    forecast: null,
    previous: null,
    units: null,
    providerUpdatedAt: null,
    fieldProvenance: {
      scheduledDate: "fred:/fred/releases/dates",
      family: `fred:mapping:${FRED_MAPPING_VERSION}`,
      importance: `fred:mapping:${FRED_MAPPING_VERSION}`,
    },
    diagnostics: {
      releaseId: mapping.releaseId,
      releaseLabel: mapping.label,
      timePrecisionNote: "FRED release dates carry no intraday time",
    },
  };
}

export function createFredProvider(apiKeyInput?: string): EconomicEventProvider {
  const descriptor = {
    providerId: FRED_PROVIDER_ID,
    sourceVersion: FRED_SOURCE_VERSION,
    mappingVersion: FRED_MAPPING_VERSION,
  };

  const fetchWindow = async (from: string, to: string): Promise<ProviderEventBatch> => {
    let apiKey: string;
    try {
      apiKey = assertNonEmpty(apiKeyInput ?? process.env["FRED_API_KEY"], "FRED_API_KEY");
    } catch (error) {
      return emptyBatch(descriptor, "authorization_error", {
        errorClass: "missing_credential",
        errorNote: safeNote(error),
        unsupported: [...FRED_UNSUPPORTED],
      });
    }

    try {
      const { status, body } = await getJson(
        "/releases/dates",
        {
          realtime_start: from,
          realtime_end: to,
          include_release_dates_with_no_data: "true",
          sort_order: "asc",
          limit: "1000",
        },
        apiKey,
      );

      if (status === 429) {
        return emptyBatch(descriptor, "throttled", {
          requestCount: 1,
          responseStatus: status,
          errorClass: "rate_limited",
          unsupported: [...FRED_UNSUPPORTED],
        });
      }
      if (status === 400 || status === 403) {
        return emptyBatch(descriptor, "authorization_error", {
          requestCount: 1,
          responseStatus: status,
          errorClass: "rejected_credential",
          errorNote: safeNote(JSON.stringify(body).slice(0, 200), [apiKey]),
          unsupported: [...FRED_UNSUPPORTED],
        });
      }
      if (status >= 500 || status === 0) {
        return emptyBatch(descriptor, "outage", {
          requestCount: 1,
          responseStatus: status,
          errorClass: "provider_5xx",
          unsupported: [...FRED_UNSUPPORTED],
        });
      }

      const rows = (body as { release_dates?: FredReleaseDate[] } | null)?.release_dates;
      if (!Array.isArray(rows)) {
        return emptyBatch(descriptor, "invalid_response", {
          requestCount: 1,
          responseStatus: status,
          errorClass: "schema_mismatch",
          errorNote: "release_dates array missing from FRED response",
          unsupported: [...FRED_UNSUPPORTED],
        });
      }

      const events = rows
        .map(normalise)
        .filter((event): event is NormalizedEvent => event !== null)
        .filter((event) => event.scheduledDate! >= from && event.scheduledDate! <= to);

      return {
        ...emptyBatch(descriptor, events.length === 0 ? "empty" : "ok"),
        events,
        requestCount: 1,
        responseStatus: status,
        unsupported: [...FRED_UNSUPPORTED],
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return emptyBatch(descriptor, "outage", {
        requestCount: 1,
        errorClass: aborted ? "timeout" : "network_error",
        errorNote: safeNote(error, [apiKey]),
        unsupported: [...FRED_UNSUPPORTED],
      });
    }
  };

  return {
    ...descriptor,
    fetchEvents: ({ from, to }) => fetchWindow(from, to),
    fetchUpdates: ({ since }) => fetchWindow(since, new Date().toISOString().slice(0, 10)),
    async health(): Promise<ProviderHealth> {
      const key = apiKeyInput ?? process.env["FRED_API_KEY"];
      if (!key) {
        return {
          providerId: FRED_PROVIDER_ID,
          status: "authorization_error",
          credentialConfigured: false,
          requestCount: 0,
          note: "FRED_API_KEY is not configured",
        };
      }
      try {
        const { status } = await getJson("/releases", { limit: "1" }, key);
        return {
          providerId: FRED_PROVIDER_ID,
          status: status === 200 ? "ok" : status === 429 ? "throttled" : "outage",
          credentialConfigured: true,
          requestCount: 1,
          note: `HTTP ${status}`,
        };
      } catch (error) {
        return {
          providerId: FRED_PROVIDER_ID,
          status: "outage",
          credentialConfigured: true,
          requestCount: 1,
          note: safeNote(error, [key]),
        };
      }
    },
  };
}
