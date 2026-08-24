/**
 * FX conversion for the shared sizing service (Prompt 12 completion patch).
 *
 * Demand-driven and bounded: the conversion plan is computed first, so zero
 * upstream requests are made when the instrument's quote currency already
 * matches the account currency, and only the direct/inverse/cross legs the plan
 * needs are fetched otherwise. Every leg must appear in an allowlist derived
 * from the instruments we actually scan and the currencies an account may be
 * denominated in — there is no arbitrary public quote proxy.
 *
 * Source timestamps are returned so staleness is a fact, not an assumption. A
 * stale required leg yields `stale: true`, which the caller turns into
 * `stale_quote` rather than a lot size.
 */
import { buildRates, planConversion, type FxPlan } from "@/lib/mcp/fx";
import { quoteSourceFresh, validQuoteGeometry } from "@/lib/metaapi/quote";
import { ACCOUNT_CURRENCIES, CONTRACT_SPECS } from "@/lib/risk";
import { INSTRUMENTS } from "@/lib/scanner/types";

/** A conversion quote older than this cannot back a position size. */
export const QUOTE_MAX_AGE_MS = 90_000;

/**
 * Every FX leg reachable from (scanned instrument quote currency -> account
 * currency). Anything outside this set is refused, so the sizing path can never
 * be used to pull arbitrary symbols from the broker.
 */
export function allowedFxSymbols(): Set<string> {
  const allowed = new Set<string>();
  for (const instrument of INSTRUMENTS) {
    const quote = CONTRACT_SPECS[instrument]?.quote;
    if (!quote) continue;
    for (const account of ACCOUNT_CURRENCIES) {
      for (const symbol of planConversion(quote, account).symbols) allowed.add(symbol);
    }
  }
  return allowed;
}

export interface ConversionResult {
  rates: Record<string, number>;
  route: FxPlan["kind"];
  /** Number of upstream broker requests actually issued. */
  requests: number;
  /** Oldest source timestamp among the legs used; null when no leg was needed. */
  quoteAsOf: string | null;
  /** A required leg carried no usable broker source timestamp. */
  timestampMissing: boolean;
  /** A required leg is older than QUOTE_MAX_AGE_MS, or has no source timestamp. */
  stale: boolean;
}

type TimedQuote = {
  bid: number;
  ask: number;
  /** Broker-supplied source time. Null/absent means unknown, never "now". */
  sourceTime?: string | null;
} | null;
export type TimedQuoteFetcher = (symbol: string) => Promise<TimedQuote>;

/**
 * Fetch exactly the legs the plan needs (deduplicated), returning mid prices and
 * the oldest source timestamp.
 *
 * Fails closed on time: a leg whose broker timestamp is missing or unparseable
 * is treated as stale. Receipt time is never substituted for source time.
 */
export async function resolveConversion(
  quoteCurrency: string,
  accountCurrency: string,
  fetchQuote: TimedQuoteFetcher,
  now = Date.now(),
): Promise<ConversionResult> {
  const plan = planConversion(quoteCurrency, accountCurrency);
  if (plan.symbols.length === 0) {
    // Parity or unsupported: no upstream request is made either way.
    return {
      rates: {},
      route: plan.kind,
      requests: 0,
      quoteAsOf: null,
      timestampMissing: false,
      stale: false,
    };
  }

  const allowed = allowedFxSymbols();
  const mids: Record<string, number> = {};
  const seen = new Set<string>();
  let requests = 0;
  let oldest: number | null = null;
  let oldestIso: string | null = null;
  let timestampMissing = false;
  let timestampOutsideWindow = false;

  for (const symbol of plan.symbols) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    if (!allowed.has(symbol)) continue;
    try {
      requests += 1;
      const q = await fetchQuote(symbol);
      if (!q || !validQuoteGeometry(q.bid, q.ask)) continue;
      mids[symbol] = (q.bid + q.ask) / 2;
      const iso = q.sourceTime ?? null;
      const at = iso ? Date.parse(iso) : Number.NaN;
      if (!Number.isFinite(at)) {
        // Missing or malformed broker timestamp: unusable for sizing.
        timestampMissing = true;
        continue;
      }
      if (!quoteSourceFresh(new Date(at).toISOString(), QUOTE_MAX_AGE_MS, now)) {
        // Track every required leg. Looking only at the oldest time would catch
        // stale history but could miss a different leg implausibly ahead of the
        // server clock.
        timestampOutsideWindow = true;
      }
      if (oldest === null || at < oldest) {
        oldest = at;
        oldestIso = new Date(at).toISOString();
      }
    } catch {
      // Absent leg -> no_conversion_rate downstream, never a guessed parity.
    }
  }

  const used = Object.keys(mids).length > 0;
  const stale =
    used &&
    (timestampMissing ||
      timestampOutsideWindow ||
      oldest === null ||
      !quoteSourceFresh(oldestIso, QUOTE_MAX_AGE_MS, now));

  return {
    rates: buildRates(quoteCurrency, accountCurrency, plan, mids),
    route: plan.kind,
    requests,
    quoteAsOf: oldestIso,
    timestampMissing,
    stale,
  };
}
