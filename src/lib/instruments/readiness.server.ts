/**
 * Instrument readiness (Phase A / A5, hardened in A1) — the
 * `disabled -> data_validation` gate.
 *
 * A pair is not "supported" because someone added its name to a list. Five
 * components must each be TRUE, and each is checked against the real provider or
 * the real database, never assumed:
 *
 *   1. mapping    — which provider symbol this canonical instrument resolves to,
 *                   for which scope, verified when, and how confidently
 *                   (`mapping.server.ts`). A stored specification is NOT proof of
 *                   an unambiguous mapping — that conflation was Finding 5.
 *   2. spec       — the provider's own digits/point/tick/lot facts, reported field
 *                   by field rather than as one boolean.
 *   3. candles    — all three timeframes return a series that is long enough AND
 *                   ordered, unduplicated, gap-free and geometrically valid
 *                   (`series.ts`).
 *   4. quote      — a well-formed bid/ask with a positive spread and a trustworthy
 *                   provider-side timestamp.
 *   5. conversion — risk in the quote currency can reach EVERY supported account
 *                   currency, not just USD.
 *
 * Components are reported SEPARATELY. `ready` is their conjunction, but a caller
 * that wants to know why must never have to guess.
 *
 * The check also DERIVES a stop-floor candidate from the provider's own point size
 * and the observed spread. That is evidence attached to a promotion decision, not
 * an automatic promotion: nothing here changes a stage or a flag.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { instrumentDefinition } from "./registry";
import { loadBrokerSpec } from "@/lib/broker/specs.server";
import { fetchCandles, fetchQuote } from "@/lib/scanner/metaapi.server";
import { planConversion } from "@/lib/mcp/fx";
import { REVALIDATION_QUOTE_MAX_AGE_MS } from "@/lib/delivery/execution";
import { fetchUsableQuote } from "./quote-retry";
import { CANDLE_LIMITS, TIMEFRAMES } from "@/lib/scanner/types";
import { writeDataHealth } from "./lifecycle.server";
import { resolveMapping, type MappingResolution } from "./mapping.server";
import { validateSeries, type SeriesReport } from "./series";

export type ReadinessComponent = "mapping" | "spec" | "candles" | "quote" | "conversion";

export interface ReadinessCheck {
  name: ReadinessComponent;
  ok: boolean;
  detail: string;
}

/** Account currencies P-Trades must be able to express risk in. */
export const SUPPORTED_ACCOUNT_CURRENCIES = ["USD", "EUR", "GBP", "AUD"] as const;

export interface ConversionLeg {
  /** Canonical leg symbol the route needs, e.g. "EURUSD". */
  symbol: string;
  /** Provider symbol the leg resolved to, or null when the mapping refused. */
  providerSymbol: string | null;
  /** True only when a well-formed, fresh quote was actually returned. */
  quotable: boolean;
  detail: string;
}

export interface ConversionCell {
  accountCurrency: string;
  route: "parity" | "direct" | "inverse" | "usd_cross" | "unsupported";
  symbols: string[];
  /**
   * Live verification of every leg the route needs (R5). A planned route is not a
   * usable route: if the provider will not quote a leg, risk in this instrument
   * cannot be expressed in that account currency, and inventing a rate would be
   * fabricating a financial input.
   */
  legs: ConversionLeg[];
  ok: boolean;
}

export interface ReadinessReport {
  symbol: string;
  ready: boolean;
  checks: ReadinessCheck[];
  /** Full mapping answer, so the caller never has to re-derive scope/freshness. */
  mapping: MappingResolution | null;
  /** Per-field specification presence. Absent fields are named, not summarised. */
  specFields: Record<string, boolean>;
  /** One entry per timeframe, with the exact series problems found. */
  series: SeriesReport[];
  /** One entry per supported account currency. */
  conversion: ConversionCell[];
  /**
   * Derived minimum stop buffer in price terms, or null when it could not be
   * measured. NEVER written into code automatically — it is evidence attached to
   * a promotion decision.
   */
  spreadFloorCandidate: number | null;
  checkedAt: string;
}

/** Minimum candles per timeframe: the 200-period EMA needs real warm-up. */
const MIN_CANDLE_RATIO = 0.9;

/** Observed spread multiplied by this becomes the stop-floor candidate. */
const SPREAD_FLOOR_MULTIPLE = 2;

export async function checkInstrumentReadiness(
  db: SupabaseClient,
  symbol: string,
): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const series: SeriesReport[] = [];
  const conversion: ConversionCell[] = [];
  let specFields: Record<string, boolean> = {};
  let spreadFloorCandidate: number | null = null;
  const now = new Date();

  const definition = instrumentDefinition(symbol);
  if (!definition) {
    return {
      symbol,
      ready: false,
      checks: [{ name: "mapping", ok: false, detail: "symbol is not in the instrument registry" }],
      mapping: null,
      specFields: {},
      series: [],
      conversion: [],
      spreadFloorCandidate: null,
      checkedAt: now.toISOString(),
    };
  }

  // ---- 1. Mapping: which provider symbol, which scope, verified when ---------
  const mapping = await resolveMapping(db, { canonical: symbol, accountId: null, now });
  checks.push({
    name: "mapping",
    ok: mapping.usable,
    detail: mapping.usable
      ? `resolved to provider symbol ${mapping.providerSymbol} (${mapping.status}), verified ${mapping.verifiedAt ?? "unknown"}`
      : `${mapping.refusal}: ${mapping.detail}`,
  });

  /**
   * The name the provider is actually asked for. When a mapping is usable —
   * including an operator binding whose specification was confirmed under that
   * exact ticker — candles and quotes MUST be requested under it, otherwise the
   * canonical name is asked for and legitimately 404s. Never a guess: an unusable
   * mapping falls back to the canonical name and fails closed as before.
   */
  const fetchSymbol = mapping.usable && mapping.providerSymbol ? mapping.providerSymbol : symbol;

  // ---- 2. Specification, field by field -------------------------------------
  const spec = await loadBrokerSpec(db, symbol);
  specFields = {
    digits: typeof spec?.digits === "number",
    point: typeof spec?.point === "number" && (spec?.point ?? 0) > 0,
    tickSize: typeof spec?.tickSize === "number" && (spec?.tickSize ?? 0) > 0,
    contractSize: (spec?.contractSize ?? 0) > 0,
    minLot: (spec?.minLot ?? 0) > 0,
    lotStep: (spec?.lotStep ?? 0) > 0,
    maxLot: typeof spec?.maxLot === "number",
    stopsLevel: typeof spec?.stopsLevel === "number",
    tradeMode: typeof spec?.tradeMode === "string",
  };
  /**
   * Required for a stage change: without point/contract size/lot bounds there is
   * no honest sizing, and without digits there is no honest price grid. `maxLot`,
   * `stopsLevel` and `tradeMode` are reported but not required, because a provider
   * may legitimately omit them and the sizing path already treats them as unknown
   * rather than zero.
   */
  const specRequired: (keyof typeof specFields)[] = [
    "digits",
    "point",
    "contractSize",
    "minLot",
    "lotStep",
  ];
  const specMissing = specRequired.filter((f) => !specFields[f]);
  checks.push({
    name: "spec",
    ok: spec !== null && specMissing.length === 0,
    detail:
      spec === null
        ? "no stored provider specification; run the specification refresh first"
        : specMissing.length === 0
          ? `digits=${spec.digits}, point=${spec.point}, tick=${spec.tickSize ?? "n/a"}, contract=${spec.contractSize}`
          : `specification is missing: ${specMissing.join(", ")}`,
  });

  // ---- 3. Candle coverage AND series integrity across all three timeframes ---
  const seriesProblems: string[] = [];
  for (const tf of TIMEFRAMES) {
    const required = Math.floor(CANDLE_LIMITS[tf] * MIN_CANDLE_RATIO);
    try {
      const candles = await fetchCandles(fetchSymbol, tf, CANDLE_LIMITS[tf]);
      const report = validateSeries({
        timeframe: tf,
        candles,
        required,
        now,
        breakToleranceMinutes: DAILY_BREAK_TOLERANCE_MINUTES[definition.assetClass] ?? 0,
      });
      series.push(report);
      if (!report.ok) {
        seriesProblems.push(
          `${tf}: ${report.findings
            .filter((f) => f.problem !== "incomplete_current_candle")
            .map((f) => f.problem)
            .join(", ")}`,
        );
      }
    } catch (err) {
      series.push({
        timeframe: tf,
        count: 0,
        required,
        ok: false,
        findings: [{ problem: "empty", detail: err instanceof Error ? err.message : String(err) }],
        lastCandleAt: null,
        missingIntervals: 0,
      });
      seriesProblems.push(`${tf} fetch failed`);
    }
  }
  checks.push({
    name: "candles",
    ok: seriesProblems.length === 0,
    detail:
      seriesProblems.length === 0
        ? "H4, H1 and M15 all returned an ordered, gap-free, gradable series"
        : seriesProblems.join("; "),
  });

  // ---- 4. A fresh, well-formed quote ---------------------------------------
  /**
   * Bounded re-quote (see `quote-retry.ts`). One malformed tick in a thin hour is
   * not a broker capability problem, but a persistently malformed feed is: the
   * attempt count is fixed and recorded, so a real defect still fails.
   */
  {
    const outcome = await fetchUsableQuote(fetchSymbol, fetchQuote, {
      requireFreshness: true,
      maxAgeMs: REVALIDATION_QUOTE_MAX_AGE_MS,
      now: () => now.getTime(),
    });
    checks.push({ name: "quote", ok: outcome.quote !== null, detail: outcome.detail });

    if (outcome.quote && specFields["point"]) {
      const spread = Number(outcome.quote.ask) - Number(outcome.quote.bid);
      const pointFloor = spec!.point! * 10;
      spreadFloorCandidate = Number(
        Math.max(spread * SPREAD_FLOOR_MULTIPLE, pointFloor).toPrecision(4),
      );
    }
  }

  // ---- 5. Conversion route for EVERY supported account currency -------------
  /**
   * Live leg verification (R5). Routes are planned from currency algebra, but a
   * route only exists if the provider actually quotes each leg. Legs are cached
   * per check so a shared USD cross costs one provider call, not four, and each
   * leg gets the same bounded re-quote as the instrument itself.
   */
  const legCache = new Map<string, ConversionLeg>();
  const verifyLeg = async (leg: string): Promise<ConversionLeg> => {
    const cached = legCache.get(leg);
    if (cached) return cached;
    let result: ConversionLeg;
    const legAuthority = await resolveMapping(db, { canonical: leg, accountId: null, now });
    if (!legAuthority.usable || !legAuthority.providerSymbol) {
      result = {
        symbol: leg,
        providerSymbol: null,
        quotable: false,
        detail: `${legAuthority.refusal}: ${legAuthority.detail}`,
      };
    } else {
      const outcome = await fetchUsableQuote(legAuthority.providerSymbol, fetchQuote, {
        requireFreshness: true,
        maxAgeMs: REVALIDATION_QUOTE_MAX_AGE_MS,
        now: () => now.getTime(),
      });
      result = {
        symbol: leg,
        providerSymbol: legAuthority.providerSymbol,
        quotable: outcome.quote !== null,
        detail: outcome.detail,
      };
    }
    legCache.set(leg, result);
    return result;
  };

  for (const accountCurrency of SUPPORTED_ACCOUNT_CURRENCIES) {
    const plan = planConversion(definition.quote, accountCurrency);
    const route: ConversionCell["route"] =
      plan.kind === "unsupported"
        ? "unsupported"
        : plan.kind === "parity"
          ? "parity"
          : plan.kind === "direct"
            ? "direct"
            : plan.kind === "inverse"
              ? "inverse"
              : "usd_cross";
    const legs: ConversionLeg[] = [];
    for (const leg of plan.symbols) {
      legs.push(await verifyLeg(leg));
    }
    conversion.push({
      accountCurrency,
      route,
      symbols: plan.symbols,
      legs,
      ok: plan.kind !== "unsupported" && legs.every((l) => l.quotable),
    });
  }
  const unsupported = conversion
    .filter((c) => c.route === "unsupported")
    .map((c) => c.accountCurrency);
  const unverified = conversion
    .filter((c) => c.route !== "unsupported" && !c.ok)
    .map(
      (c) =>
        `${c.accountCurrency} (${c.legs
          .filter((l) => !l.quotable)
          .map((l) => `${l.symbol}: ${l.detail}`)
          .join("; ")})`,
    );
  checks.push({
    name: "conversion",
    ok: unsupported.length === 0 && unverified.length === 0,
    detail:
      unsupported.length === 0 && unverified.length === 0
        ? `${definition.quote} risk converts to ${conversion.map((c) => `${c.accountCurrency} (${c.route})`).join(", ")}, every leg quoted live`
        : [
            unsupported.length
              ? `no supported conversion route from ${definition.quote} to ${unsupported.join(", ")}`
              : null,
            unverified.length
              ? `conversion legs not verifiable for ${unverified.join(", ")}`
              : null,
          ]
            .filter(Boolean)
            .join("; "),
  });

  const ready = checks.every((c) => c.ok);
  const report: ReadinessReport = {
    symbol,
    ready,
    checks,
    mapping,
    specFields,
    series,
    conversion,
    spreadFloorCandidate,
    checkedAt: now.toISOString(),
  };

  await writeDataHealth(
    db,
    symbol,
    ready
      ? "readiness passed"
      : `readiness failed: ${checks
          .filter((c) => !c.ok)
          .map((c) => c.name)
          .join(", ")}`,
  );

  return report;
}
