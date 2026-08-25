/**
 * EIA (U.S. Energy Information Administration) adapter — energy inventory data.
 *
 * The Weekly Petroleum Status Report is the dominant scheduled risk for USOIL and
 * UKOIL. Two separate facts, kept separate:
 *
 *   - PUBLISHED VALUES: the v2 API serves weekly crude stock series, keyed by
 *     `period` (the week ending date). This is what the adapter ingests.
 *   - RELEASE SCHEDULE: the API does not serve the report's future publication
 *     schedule or its holiday-adjusted release times. Those live on an HTML page.
 *     No future EIA event is emitted, and every ingested row is `date_only`
 *     precision with status `published` — so it can never authorise a forward
 *     intraday suppression window.
 *
 * Monthly datasets (for example crude imports by country) are classified as
 * CONTEXT, not as tradable events: they are long-latency statistics, not scheduled
 * intraday market movers.
 */
import { canonicalEventId, providerEventKey } from "../identity";
import { safeNote } from "../redact";
import {
  emptyBatch,
  type EconomicEventProvider,
  type NormalizedEvent,
  type ProviderEventBatch,
  type ProviderHealth,
  type UnsupportedScope,
} from "../types";

const BASE = "https://api.eia.gov/v2";
const FETCH_TIMEOUT_MS = 8_000;

export const EIA_PROVIDER_ID = "eia";
export const EIA_SOURCE_VERSION = "eia-v2-petroleum-weekly-stocks-v1";
export const EIA_MAPPING_VERSION = "eia-map-1";

/** Weekly series we ingest, each mapped to a family and an importance. */
export const EIA_SERIES = [
  {
    seriesId: "WCESTUS1",
    slug: "us-crude-oil-stocks",
    label: "U.S. Ending Stocks of Crude Oil",
    importance: "high" as const,
  },
] as const;

const SERIES_BY_ID: Map<string, (typeof EIA_SERIES)[number]> = new Map(
  EIA_SERIES.map((s) => [s.seriesId as string, s]),
);

const EIA_NON_USD = ["EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"] as const;
const EIA_NON_ENERGY_FAMILIES = [
  "central_bank",
  "inflation",
  "employment",
  "us_macro",
  "earnings_season",
  "opec_supply",
] as const;

/**
 * EIA covers exactly one scope: USD energy inventories. Everything else is
 * declared unsupported so the coverage calculation cannot credit it.
 */
export const EIA_UNSUPPORTED: readonly UnsupportedScope[] = [
  ...EIA_NON_USD.map((currency) => ({
    currency,
    note: "EIA publishes US energy data only",
  })),
  ...EIA_NON_ENERGY_FAMILIES.map((family) => ({
    currency: "USD",
    family,
    note:
      family === "opec_supply"
        ? "OPEC publishes no machine-readable announcement feed; EIA does not carry OPEC decisions"
        : "EIA publishes energy inventory data only",
  })),
];

/**
 * Documented gap, kept visible: the Weekly Petroleum Status Report publication
 * schedule (including holiday-adjusted release times) is not served by the API, so
 * no forward EIA event is ever emitted.
 */
export const EIA_SCHEDULE_NOTE =
  "EIA v2 serves published values only; the Weekly Petroleum Status Report release schedule is not machine-readable";

export type EiaDatasetClass = "tradable_weekly" | "context_monthly" | "unclassified";

/**
 * Classify an EIA dataset route so a monthly statistic is never treated as a
 * scheduled intraday event.
 */
export function classifyEiaDataset(route: string): EiaDatasetClass {
  const normalised = route.toLowerCase();
  if (normalised.includes("frequency=weekly") || normalised.includes("/stoc/wstk")) {
    return "tradable_weekly";
  }
  if (normalised.includes("frequency=monthly") || normalised.includes("/move/impcus")) {
    return "context_monthly";
  }
  return "unclassified";
}

interface EiaRow {
  period?: string;
  series?: string;
  value?: number | string | null;
  units?: string | null;
}

async function getJson(
  path: string,
  params: [string, string][],
  apiKey: string,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of params) url.searchParams.append(key, value);
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

function normalise(row: EiaRow): NormalizedEvent | null {
  const mapping = row.series ? SERIES_BY_ID.get(row.series) : undefined;
  const period = row.period;
  if (!mapping || !period || !/^\d{4}-\d{2}-\d{2}$/.test(period)) return null;
  const numeric =
    row.value === null || row.value === undefined || row.value === "" ? null : Number(row.value);

  return {
    providerEventKey: providerEventKey([EIA_PROVIDER_ID, mapping.seriesId, period]),
    canonicalEventId: canonicalEventId({ scope: "USD", slug: mapping.slug, period }),
    family: "energy_inventory",
    countries: ["US"],
    currencies: ["USD"],
    importance: mapping.importance,
    // Published value for a past week. No forward instant is claimed.
    scheduledAt: null,
    scheduledDate: period,
    timestampPrecision: "date_only",
    status: numeric === null ? "scheduled" : "published",
    actual: Number.isFinite(numeric) ? numeric : null,
    forecast: null,
    previous: null,
    units: row.units ?? null,
    providerUpdatedAt: null,
    fieldProvenance: {
      actual: `eia:v2:${mapping.seriesId}`,
      scheduledDate: "eia:v2:period",
      family: `eia:mapping:${EIA_MAPPING_VERSION}`,
    },
    diagnostics: {
      seriesId: mapping.seriesId,
      seriesLabel: mapping.label,
      datasetClass: "tradable_weekly",
      scheduleNote: "publication schedule is not available from the EIA API",
    },
  };
}

export function createEiaProvider(apiKeyInput?: string): EconomicEventProvider {
  const descriptor = {
    providerId: EIA_PROVIDER_ID,
    sourceVersion: EIA_SOURCE_VERSION,
    mappingVersion: EIA_MAPPING_VERSION,
  };

  const fetchWindow = async (from: string, to: string): Promise<ProviderEventBatch> => {
    const apiKey = apiKeyInput ?? process.env["EIA_API_KEY"];
    if (!apiKey || apiKey.trim().length === 0) {
      return emptyBatch(descriptor, "authorization_error", {
        errorClass: "missing_credential",
        errorNote: "EIA_API_KEY is not configured",
        unsupported: [...EIA_UNSUPPORTED],
      });
    }

    try {
      const params: [string, string][] = [
        ["frequency", "weekly"],
        ["data[0]", "value"],
        ["start", from],
        ["end", to],
        ["sort[0][column]", "period"],
        ["sort[0][direction]", "asc"],
        ["length", "500"],
      ];
      for (const series of EIA_SERIES) params.push(["facets[series][]", series.seriesId]);

      const { status, body } = await getJson("/petroleum/stoc/wstk/data/", params, apiKey);

      if (status === 429) {
        return emptyBatch(descriptor, "throttled", {
          requestCount: 1,
          responseStatus: status,
          errorClass: "rate_limited",
          unsupported: [...EIA_UNSUPPORTED],
        });
      }
      if (status === 401 || status === 403) {
        return emptyBatch(descriptor, "authorization_error", {
          requestCount: 1,
          responseStatus: status,
          errorClass: "rejected_credential",
          errorNote: safeNote(
            (body as { error?: { code?: string } } | null)?.error?.code ?? "credential rejected",
            [apiKey],
          ),
          unsupported: [...EIA_UNSUPPORTED],
        });
      }
      if (status >= 500) {
        return emptyBatch(descriptor, "outage", {
          requestCount: 1,
          responseStatus: status,
          errorClass: "provider_5xx",
          unsupported: [...EIA_UNSUPPORTED],
        });
      }

      const rows = (body as { response?: { data?: EiaRow[] } } | null)?.response?.data;
      if (!Array.isArray(rows)) {
        return emptyBatch(descriptor, "invalid_response", {
          requestCount: 1,
          responseStatus: status,
          errorClass: "schema_mismatch",
          errorNote: "response.data array missing from EIA response",
          unsupported: [...EIA_UNSUPPORTED],
        });
      }

      const events = rows
        .map(normalise)
        .filter((event): event is NormalizedEvent => event !== null);

      return {
        ...emptyBatch(descriptor, events.length === 0 ? "empty" : "ok"),
        events,
        requestCount: 1,
        responseStatus: status,
        unsupported: [...EIA_UNSUPPORTED],
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return emptyBatch(descriptor, "outage", {
        requestCount: 1,
        errorClass: aborted ? "timeout" : "network_error",
        errorNote: safeNote(error, [apiKey]),
        unsupported: [...EIA_UNSUPPORTED],
      });
    }
  };

  return {
    ...descriptor,
    fetchEvents: ({ from, to }) => fetchWindow(from, to),
    async health(): Promise<ProviderHealth> {
      const key = apiKeyInput ?? process.env["EIA_API_KEY"];
      if (!key) {
        return {
          providerId: EIA_PROVIDER_ID,
          status: "authorization_error",
          credentialConfigured: false,
          requestCount: 0,
          note: "EIA_API_KEY is not configured",
        };
      }
      const probe = await fetchWindow(
        new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10),
        new Date().toISOString().slice(0, 10),
      );
      return {
        providerId: EIA_PROVIDER_ID,
        status: probe.status,
        credentialConfigured: true,
        requestCount: probe.requestCount,
        note: probe.errorNote ?? `HTTP ${probe.responseStatus ?? "n/a"}`,
      };
    },
  };
}
