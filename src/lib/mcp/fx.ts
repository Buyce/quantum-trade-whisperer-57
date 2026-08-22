/**
 * Demand-driven FX conversion for MCP position sizing (Prompt 11).
 *
 * The old implementation fetched a fixed list of quotes on EVERY call, including
 * when the instrument's quote currency already matched the account currency.
 * That spent MetaApi requests for nothing. Here the plan is computed first, so a
 * call issues the minimum number of quotes — zero when currencies match — and
 * returns an explicit unsupported verdict when no route exists.
 *
 * This module never touches the scanner's MetaApi path.
 */

/** USD-crossed pairs the broker feed is known to quote. */
export const FX_MAJORS = [
  "EURUSD",
  "GBPUSD",
  "AUDUSD",
  "NZDUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
] as const;

const MAJORS = new Set<string>(FX_MAJORS);

export type FxPlan =
  | { kind: "parity"; symbols: [] }
  | { kind: "direct"; symbols: [string] }
  | { kind: "inverse"; symbols: [string] }
  | { kind: "cross"; symbols: [string, string]; via: "USD" }
  | { kind: "unsupported"; symbols: [] };

/**
 * The quotes required to express one unit of `quote` in `accountCurrency`.
 * Deterministic and side-effect free so it can be asserted in tests.
 */
export function planConversion(quote: string, accountCurrency: string): FxPlan {
  const from = quote.toUpperCase();
  const to = accountCurrency.toUpperCase();
  if (from === to) return { kind: "parity", symbols: [] };
  if (MAJORS.has(`${from}${to}`)) return { kind: "direct", symbols: [`${from}${to}`] };
  if (MAJORS.has(`${to}${from}`)) return { kind: "inverse", symbols: [`${to}${from}`] };
  // Neither leg is USD, so route through USD: (from/USD) / (to/USD).
  const fromLeg = MAJORS.has(`${from}USD`)
    ? `${from}USD`
    : MAJORS.has(`USD${from}`)
      ? `USD${from}`
      : null;
  const toLeg = MAJORS.has(`${to}USD`) ? `${to}USD` : MAJORS.has(`USD${to}`) ? `USD${to}` : null;
  if (!fromLeg || !toLeg) return { kind: "unsupported", symbols: [] };
  return { kind: "cross", symbols: [fromLeg, toLeg], via: "USD" };
}

/** Mid price of `base` expressed in USD, from a mid-price lookup. */
function usdRate(currency: string, mids: Record<string, number>): number | null {
  const direct = mids[`${currency}USD`];
  if (direct && direct > 0) return direct;
  const inverse = mids[`USD${currency}`];
  if (inverse && inverse > 0) return 1 / inverse;
  return null;
}

/**
 * Rates map for `calculateRisk`, keyed the way `conversionRate` expects.
 * A cross route is collapsed into a single synthetic `${quote}${account}` entry.
 */
export function buildRates(
  quote: string,
  accountCurrency: string,
  plan: FxPlan,
  mids: Record<string, number>,
): Record<string, number> {
  const from = quote.toUpperCase();
  const to = accountCurrency.toUpperCase();
  if (plan.kind === "parity") return {};
  if (plan.kind === "direct" || plan.kind === "inverse") {
    const symbol = plan.symbols[0];
    const mid = mids[symbol];
    return mid && mid > 0 ? { [symbol]: mid } : {};
  }
  if (plan.kind === "cross") {
    const fromUsd = usdRate(from, mids);
    const toUsd = usdRate(to, mids);
    if (!fromUsd || !toUsd) return {};
    return { [`${from}${to}`]: fromUsd / toUsd };
  }
  return {};
}

export type QuoteFetcher = (symbol: string) => Promise<{ bid: number; ask: number } | null>;

/**
 * Fetch exactly the quotes the plan requires, memoized per symbol so a repeated
 * leg costs one request. Returns mid prices; failures are simply absent, which
 * makes `calculateRisk` report `no_conversion_rate` instead of assuming parity.
 */
export async function fetchMids(
  symbols: readonly string[],
  fetchQuote: QuoteFetcher,
): Promise<Record<string, number>> {
  const mids: Record<string, number> = {};
  const seen = new Set<string>();
  for (const symbol of symbols) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    try {
      const q = await fetchQuote(symbol);
      if (q && q.bid > 0 && q.ask > 0) mids[symbol] = (q.bid + q.ask) / 2;
    } catch {
      // Absent rate → explicit unavailable downstream, never a guessed number.
    }
  }
  return mids;
}

/** Convenience wrapper: plan, fetch only what is needed, return a rates map. */
export async function resolveConversionRates(
  quote: string,
  accountCurrency: string,
  fetchQuote: QuoteFetcher,
): Promise<{ plan: FxPlan; rates: Record<string, number>; requests: number }> {
  const plan = planConversion(quote, accountCurrency);
  if (plan.symbols.length === 0) return { plan, rates: {}, requests: 0 };
  const mids = await fetchMids(plan.symbols, fetchQuote);
  return {
    plan,
    rates: buildRates(quote, accountCurrency, plan, mids),
    requests: Object.keys(mids).length,
  };
}
