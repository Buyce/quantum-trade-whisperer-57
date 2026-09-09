/**
 * Market-context ingestion (intermarket series and futures positioning).
 *
 * Three official, licence-clean sources, all plain HTTPS/JSON or CSV:
 *   - FRED (St. Louis Fed)  — dollar index, US 2y/10y yields, gold, WTI oil.
 *   - CBOE                  — the VIX daily history CSV.
 *   - CFTC public reporting — weekly Commitments of Traders positioning.
 *
 * Honesty rules, enforced here and pinned by tests:
 *   - A failed or unparseable fetch writes a ledger row and NO value. A missing
 *     reading is never stored as zero, flat, calm or neutral.
 *   - Only numbers actually present in the response body are stored. Nothing is
 *     interpolated, carried forward or estimated.
 *   - Every row records the source it came from and the observation date the
 *     source itself published, so staleness is always visible.
 */
import type { SeriesKey } from "./derive";

const TIMEOUT_MS = 8_000;

interface MinimalClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export type RunStatus =
  "ok" | "empty" | "partial" | "outage" | "authorization_error" | "invalid_response" | "throttled";

export interface ContextRunResult {
  job: string;
  source: string;
  status: RunStatus;
  seriesRequested: number;
  valuesWritten: number;
  requestCount: number;
  errorClass: string | null;
  errorNote: string | null;
}

/** FRED series ids behind each of our keys. Fixed mapping, never inferred. */
export const FRED_SERIES: Readonly<Record<string, { key: SeriesKey; units: string }>> = {
  DTWEXBGS: { key: "dollar_index", units: "index" },
  DGS2: { key: "us_2y_yield", units: "percent" },
  DGS10: { key: "us_10y_yield", units: "percent" },
  // Gold: LBMA PM fix in USD, the only gold series FRED publishes daily.
  IQ12260: { key: "gold", units: "usd" },
  DCOILWTICO: { key: "wti_oil", units: "usd" },
};

/** CFTC market codes for the currency futures we care about. */
export const CFTC_MARKETS: Readonly<Record<string, string>> = {
  "099741": "EUR",
  "096742": "GBP",
  "097741": "JPY",
  "232741": "AUD",
  "090741": "CAD",
  "092741": "CHF",
};

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { accept: "*/*" } });
  } finally {
    clearTimeout(timer);
  }
}

function classify(status: number): RunStatus {
  if (status === 401 || status === 403) return "authorization_error";
  if (status === 429) return "throttled";
  return "outage";
}

/** Never let a URL carrying an API key reach a log or the ledger. */
function scrub(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/api_key=[^&\s]+/gi, "api_key=[redacted]").slice(0, 300);
}

/**
 * FRED observations for our fixed series list.
 *
 * FRED marks a missing observation as "."; those rows are skipped, never
 * coerced to a number.
 */
export async function fetchFredSeries(
  apiKey: string | undefined,
  fromDate: string,
): Promise<{ status: RunStatus; requestCount: number; errorNote: string | null; rows: FredRow[] }> {
  if (!apiKey) {
    return {
      status: "authorization_error",
      requestCount: 0,
      errorNote: "FRED_API_KEY is not configured",
      rows: [],
    };
  }
  const rows: FredRow[] = [];
  let requests = 0;
  let failures = 0;
  let lastNote: string | null = null;

  for (const [seriesId, meta] of Object.entries(FRED_SERIES)) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}` +
      `&observation_start=${fromDate}&file_type=json&api_key=${apiKey}`;
    requests += 1;
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        failures += 1;
        lastNote = `${seriesId}: HTTP ${response.status}`;
        if (response.status === 401 || response.status === 403 || response.status === 429) {
          return {
            status: classify(response.status),
            requestCount: requests,
            errorNote: lastNote,
            rows,
          };
        }
        continue;
      }
      const body = (await response.json()) as { observations?: { date: string; value: string }[] };
      const observations = body.observations;
      if (!Array.isArray(observations)) {
        failures += 1;
        lastNote = `${seriesId}: response did not contain observations`;
        continue;
      }
      for (const observation of observations) {
        const value = Number(observation.value);
        // "." is FRED's missing marker. Skip it; never store a fabricated value.
        if (!Number.isFinite(value)) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(observation.date)) continue;
        rows.push({
          seriesKey: meta.key,
          observationDate: observation.date,
          value,
          source: "fred",
          sourceSeriesId: seriesId,
          units: meta.units,
        });
      }
    } catch (err) {
      failures += 1;
      lastNote = scrub(`${seriesId}: ${err instanceof Error ? err.message : String(err)}`, [
        apiKey,
      ]);
    }
  }

  const total = Object.keys(FRED_SERIES).length;
  const status: RunStatus =
    failures === 0 ? (rows.length > 0 ? "ok" : "empty") : failures === total ? "outage" : "partial";
  return {
    status,
    requestCount: requests,
    errorNote: lastNote ? scrub(lastNote, [apiKey]) : null,
    rows,
  };
}

export interface FredRow {
  seriesKey: SeriesKey;
  observationDate: string;
  value: number;
  source: string;
  sourceSeriesId: string;
  units: string;
}

/** CBOE publishes VIX history as a plain CSV: DATE,OPEN,HIGH,LOW,CLOSE. */
export function parseVixCsv(csv: string, sinceDate: string): FredRow[] {
  const lines = csv.trim().split(/\r?\n/);
  const rows: FredRow[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    if (parts.length < 5) continue;
    const rawDate = (parts[0] ?? "").trim();
    const close = Number((parts[4] ?? "").trim());
    if (!Number.isFinite(close)) continue;
    // CBOE writes M/D/YYYY historically and YYYY-MM-DD in the current file.
    let iso: string | null = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) iso = rawDate;
    else {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawDate);
      if (m)
        iso = `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`.replace(
          /-(\d)-/,
          "-0$1-",
        );
    }
    if (!iso || iso < sinceDate) continue;
    rows.push({
      seriesKey: "vix",
      observationDate: iso,
      value: close,
      source: "cboe",
      sourceSeriesId: "VIX_History.csv",
      units: "index",
    });
  }
  return rows;
}

export async function fetchVix(
  sinceDate: string,
): Promise<{ status: RunStatus; requestCount: number; errorNote: string | null; rows: FredRow[] }> {
  const url = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv";
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return {
        status: classify(response.status),
        requestCount: 1,
        errorNote: `VIX history: HTTP ${response.status}`,
        rows: [],
      };
    }
    const rows = parseVixCsv(await response.text(), sinceDate);
    return {
      status: rows.length > 0 ? "ok" : "empty",
      requestCount: 1,
      errorNote: rows.length > 0 ? null : "VIX history contained no usable rows in the window",
      rows,
    };
  } catch (err) {
    return {
      status: "outage",
      requestCount: 1,
      errorNote: scrub(err instanceof Error ? err.message : String(err), []),
      rows: [],
    };
  }
}

export interface PositioningRow {
  currency: string;
  reportDate: string;
  longContracts: number | null;
  shortContracts: number | null;
  netContracts: number | null;
  netPercent: number | null;
  source: string;
  sourceMarketCode: string;
}

/**
 * CFTC Commitments of Traders — weekly, published Friday for the prior Tuesday.
 *
 * The report date is stored so its staleness is always visible: this is a slow
 * bias reading, never a trigger.
 */
export async function fetchPositioning(sinceDate: string): Promise<{
  status: RunStatus;
  requestCount: number;
  errorNote: string | null;
  rows: PositioningRow[];
}> {
  const codes = Object.keys(CFTC_MARKETS)
    .map((c) => `'${c}'`)
    .join(",");
  const url =
    "https://publicreporting.cftc.gov/resource/6dca-aqww.json" +
    `?$where=cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd > '${sinceDate}T00:00:00.000'` +
    "&$select=cftc_contract_market_code,report_date_as_yyyy_mm_dd,noncomm_positions_long_all,noncomm_positions_short_all" +
    "&$limit=500";
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return {
        status: classify(response.status),
        requestCount: 1,
        errorNote: `CFTC: HTTP ${response.status}`,
        rows: [],
      };
    }
    const body = (await response.json()) as Record<string, string>[];
    if (!Array.isArray(body)) {
      return {
        status: "invalid_response",
        requestCount: 1,
        errorNote: "CFTC response was not a list",
        rows: [],
      };
    }
    const rows: PositioningRow[] = [];
    for (const item of body) {
      const code = item["cftc_contract_market_code"];
      const currency = code ? CFTC_MARKETS[code] : undefined;
      const reportDate = (item["report_date_as_yyyy_mm_dd"] ?? "").slice(0, 10);
      if (!currency || !code || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) continue;
      const long = Number(item["noncomm_positions_long_all"]);
      const short = Number(item["noncomm_positions_short_all"]);
      const haveBoth = Number.isFinite(long) && Number.isFinite(short);
      const total = haveBoth ? long + short : 0;
      rows.push({
        currency,
        reportDate,
        longContracts: Number.isFinite(long) ? long : null,
        shortContracts: Number.isFinite(short) ? short : null,
        netContracts: haveBoth ? long - short : null,
        netPercent: haveBoth && total > 0 ? ((long - short) / total) * 100 : null,
        source: "cftc",
        sourceMarketCode: code,
      });
    }
    return {
      status: rows.length > 0 ? "ok" : "empty",
      requestCount: 1,
      errorNote: rows.length > 0 ? null : "CFTC returned no rows for the requested markets",
      rows,
    };
  } catch (err) {
    return {
      status: "outage",
      requestCount: 1,
      errorNote: scrub(err instanceof Error ? err.message : String(err), []),
      rows: [],
    };
  }
}

/** One ledger row per job, written whatever the outcome. */
async function recordRun(db: MinimalClient, result: ContextRunResult, startedAt: string) {
  try {
    await db.from("market_context_runs").insert({
      job: result.job,
      source: result.source,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: result.status,
      series_requested: result.seriesRequested,
      values_written: result.valuesWritten,
      request_count: result.requestCount,
      error_class: result.errorClass,
      error_note: result.errorNote,
    });
  } catch (err) {
    console.error("[market-context] ledger write failed:", err);
  }
}

/** Run every context job. Each job is independent: one failure never blocks another. */
export async function runMarketContextIngestion(
  db: MinimalClient,
  nowMs: number,
): Promise<ContextRunResult[]> {
  const results: ContextRunResult[] = [];
  const seriesSince = new Date(nowMs - 30 * 86_400_000).toISOString().slice(0, 10);
  const positioningSince = new Date(nowMs - 120 * 86_400_000).toISOString().slice(0, 10);

  // ---- FRED -------------------------------------------------------------
  {
    const startedAt = new Date().toISOString();
    const fred = await fetchFredSeries(process.env["FRED_API_KEY"], seriesSince);
    let written = 0;
    if (fred.rows.length > 0) {
      const { error } = await db.from("market_context_series").upsert(
        fred.rows.map((row) => ({
          series_key: row.seriesKey,
          observation_date: row.observationDate,
          value: row.value,
          source: row.source,
          source_series_id: row.sourceSeriesId,
          units: row.units,
        })),
        { onConflict: "series_key,observation_date" },
      );
      if (error) console.error("[market-context] FRED write failed:", error.message);
      else written = fred.rows.length;
    }
    const result: ContextRunResult = {
      job: "intermarket_series",
      source: "fred",
      status: written === 0 && fred.status === "ok" ? "invalid_response" : fred.status,
      seriesRequested: Object.keys(FRED_SERIES).length,
      valuesWritten: written,
      requestCount: fred.requestCount,
      errorClass: fred.status === "ok" ? null : fred.status,
      errorNote: fred.errorNote,
    };
    await recordRun(db, result, startedAt);
    results.push(result);
  }

  // ---- CBOE VIX ---------------------------------------------------------
  {
    const startedAt = new Date().toISOString();
    const vix = await fetchVix(seriesSince);
    let written = 0;
    if (vix.rows.length > 0) {
      const { error } = await db.from("market_context_series").upsert(
        vix.rows.map((row) => ({
          series_key: row.seriesKey,
          observation_date: row.observationDate,
          value: row.value,
          source: row.source,
          source_series_id: row.sourceSeriesId,
          units: row.units,
        })),
        { onConflict: "series_key,observation_date" },
      );
      if (error) console.error("[market-context] VIX write failed:", error.message);
      else written = vix.rows.length;
    }
    const result: ContextRunResult = {
      job: "volatility_regime",
      source: "cboe",
      status: vix.status,
      seriesRequested: 1,
      valuesWritten: written,
      requestCount: vix.requestCount,
      errorClass: vix.status === "ok" ? null : vix.status,
      errorNote: vix.errorNote,
    };
    await recordRun(db, result, startedAt);
    results.push(result);
  }

  // ---- CFTC positioning -------------------------------------------------
  {
    const startedAt = new Date().toISOString();
    const cot = await fetchPositioning(positioningSince);
    let written = 0;
    if (cot.rows.length > 0) {
      const { error } = await db.from("positioning_snapshots").upsert(
        cot.rows.map((row) => ({
          currency: row.currency,
          report_date: row.reportDate,
          long_contracts: row.longContracts,
          short_contracts: row.shortContracts,
          net_contracts: row.netContracts,
          net_percent: row.netPercent,
          source: row.source,
          source_market_code: row.sourceMarketCode,
        })),
        { onConflict: "currency,report_date,source" },
      );
      if (error) console.error("[market-context] CFTC write failed:", error.message);
      else written = cot.rows.length;
    }
    const result: ContextRunResult = {
      job: "positioning",
      source: "cftc",
      status: cot.status,
      seriesRequested: Object.keys(CFTC_MARKETS).length,
      valuesWritten: written,
      requestCount: cot.requestCount,
      errorClass: cot.status === "ok" ? null : cot.status,
      errorNote: cot.errorNote,
    };
    await recordRun(db, result, startedAt);
    results.push(result);
  }

  return results;
}
