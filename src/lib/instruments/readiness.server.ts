/**
 * Instrument readiness (Phase A / A5) — the `disabled -> data_validation` gate.
 *
 * A pair is not "supported" because someone added its name to a list. Before it
 * may be scanned at all, five things must be TRUE and each is checked against the
 * real provider or the real database, never assumed:
 *
 *   1. mapping    — the broker exposes a symbol we can resolve unambiguously;
 *   2. spec       — `broker_symbol_specs` holds digits/point/lot bounds for it;
 *   3. candles    — all three timeframes return enough history to grade;
 *   4. quote      — a fresh, well-formed bid/ask exists;
 *   5. conversion — risk in the quote currency can be converted to USD.
 *
 * The check also DERIVES a stop-floor candidate from the broker's own point size
 * and the observed spread. Wave 0's floors are frozen literals that were validated
 * historically; a new pair must earn one the same way rather than inherit a shared
 * default. `spreadFloorCandidate` is a measurement to be reviewed, not an
 * automatic promotion: nothing here changes a stage.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { instrumentDefinition } from "./registry";
import { loadBrokerSpec } from "@/lib/broker/specs.server";
import { fetchCandles, fetchQuote } from "@/lib/scanner/metaapi.server";
import { planConversion } from "@/lib/mcp/fx";
import { REVALIDATION_QUOTE_MAX_AGE_MS } from "@/lib/delivery/execution";
import { quoteSourceFresh, validQuoteGeometry } from "@/lib/metaapi/quote";
import { CANDLE_LIMITS, TIMEFRAMES } from "@/lib/scanner/types";
import { writeDataHealth } from "./lifecycle.server";

export interface ReadinessCheck {
  name: "mapping" | "spec" | "candles" | "quote" | "conversion";
  ok: boolean;
  detail: string;
}

export interface ReadinessReport {
  symbol: string;
  ready: boolean;
  checks: ReadinessCheck[];
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
  let spreadFloorCandidate: number | null = null;

  const definition = instrumentDefinition(symbol);
  if (!definition) {
    return {
      symbol,
      ready: false,
      checks: [{ name: "mapping", ok: false, detail: "symbol is not in the instrument registry" }],
      spreadFloorCandidate: null,
      checkedAt: new Date().toISOString(),
    };
  }

  // ---- 2. Broker specification (also proves the mapping resolved) -----------
  const spec = await loadBrokerSpec(db, symbol);
  checks.push({
    name: "mapping",
    ok: spec !== null,
    detail:
      spec !== null
        ? `broker exposes ${symbol}`
        : `no stored broker specification for ${symbol}; run the specification refresh first`,
  });
  const specComplete =
    spec !== null && spec.point !== null && spec.point > 0 && spec.contractSize > 0;
  checks.push({
    name: "spec",
    ok: specComplete,
    detail: specComplete
      ? `point=${spec!.point}, contract size=${spec!.contractSize}`
      : "the stored specification is missing a usable point size or contract size",
  });

  // ---- 3. Candle coverage across all three timeframes -----------------------
  const missing: string[] = [];
  for (const tf of TIMEFRAMES) {
    try {
      const candles = await fetchCandles(symbol, tf, CANDLE_LIMITS[tf]);
      const need = Math.floor(CANDLE_LIMITS[tf] * MIN_CANDLE_RATIO);
      if (candles.length < need) missing.push(`${tf} returned ${candles.length}/${need}`);
    } catch (err) {
      missing.push(`${tf} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  checks.push({
    name: "candles",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "H4, H1 and M15 all returned gradable history" : missing.join("; "),
  });

  // ---- 4. A fresh, well-formed quote ---------------------------------------
  try {
    const quote = await fetchQuote(symbol);
    const geometryOk = quote !== null && validQuoteGeometry(quote.bid, quote.ask);
    // The SAME staleness rule the pre-send gate uses, and it reads the broker's
    // own source timestamp — never local time.
    const fresh =
      quote !== null && quoteSourceFresh(quote.sourceTime, REVALIDATION_QUOTE_MAX_AGE_MS);
    checks.push({
      name: "quote",
      ok: geometryOk && fresh,
      detail: !quote
        ? "no quote was returned"
        : !geometryOk
          ? "the quote geometry was invalid (bid/ask not usable)"
          : !fresh
            ? "the quote's own source timestamp was too old to trust"
            : `bid=${quote.bid}, ask=${quote.ask}`,
    });

    if (geometryOk && fresh && specComplete) {
      const spread = Math.abs(Number(quote.ask) - Number(quote.bid));
      const pointFloor = spec!.point! * 10;
      if (spread > 0) {
        spreadFloorCandidate = Number(
          Math.max(spread * SPREAD_FLOOR_MULTIPLE, pointFloor).toPrecision(4),
        );
      }
    }
  } catch (err) {
    checks.push({
      name: "quote",
      ok: false,
      detail: `quote fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ---- 5. Risk-currency conversion route -----------------------------------
  const plan = planConversion(definition.quote, "USD");
  const convertible = plan.kind !== "unsupported";
  checks.push({
    name: "conversion",
    ok: convertible,
    detail: convertible
      ? plan.symbols.length === 0
        ? "risk is already denominated in USD"
        : `convertible via ${plan.symbols.join(", ")}`
      : `no supported conversion route from ${definition.quote} to USD`,
  });

  const ready = checks.every((c) => c.ok);
  const report: ReadinessReport = {
    symbol,
    ready,
    checks,
    spreadFloorCandidate,
    checkedAt: new Date().toISOString(),
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
