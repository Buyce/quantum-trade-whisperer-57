/**
 * Bounded re-quote for readiness evidence.
 *
 * A single malformed tick is not a broker capability problem. Production proved
 * this twice: GBPUSD failed readiness on one zero-spread tick during a thin hour,
 * and USDCHF's own conversion leg was recorded as "missing" from one failed fetch
 * while every neighbouring snapshot quoted it fine.
 *
 * So readiness re-asks a small, bounded number of times before it concludes
 * anything. This is NOT permissive:
 *
 *   - the number of attempts is fixed and recorded in the failure detail, so a
 *     genuinely broken instrument still fails and says how hard we tried;
 *   - nothing is inferred, averaged or carried over from an earlier snapshot — a
 *     usable quote must actually arrive inside this call;
 *   - the failure reason distinguishes "the tick was malformed" from "there was
 *     no quote at all", because those lead to different operator decisions.
 *
 * Pure apart from the injected fetcher and sleeper, so it is fully testable.
 */
import { quoteSourceFresh, validQuoteGeometry } from "@/lib/metaapi/quote";

export type QuoteFailure =
  | "no_quote"
  | "malformed_tick"
  | "zero_or_inverted_spread"
  | "stale_source_time"
  | "future_source_time"
  | "fetch_failed";

export interface RetryableQuote {
  bid: number;
  ask: number;
  sourceTime?: string | null;
}

export interface UsableQuoteOutcome<Q extends RetryableQuote> {
  /** The first usable quote, or null when every attempt failed. */
  quote: Q | null;
  /** How many provider requests this call actually spent. */
  attempts: number;
  /** Reason of the LAST attempt, null when a usable quote arrived. */
  failure: QuoteFailure | null;
  /** Operator-facing sentence; safe to store in a snapshot. */
  detail: string;
}

/** Attempts per readiness quote. Small on purpose: this runs inside a cron budget. */
export const QUOTE_ATTEMPTS = 3;

/** Gap between attempts — long enough for a new tick, short enough for the budget. */
export const QUOTE_RETRY_DELAY_MS = 400;

const FAILURE_TEXT: Record<QuoteFailure, string> = {
  no_quote: "the provider returned no quote",
  malformed_tick: "the quote geometry was invalid (bid/ask not usable)",
  zero_or_inverted_spread: "the quote had a zero or inverted spread",
  stale_source_time: "the quote's own source timestamp was too old to trust",
  future_source_time: "the quote's own source timestamp is in the future",
  fetch_failed: "the quote request failed",
};

export interface UsableQuoteOptions {
  attempts?: number;
  delayMs?: number;
  /** When true, the provider's own source timestamp must be present and fresh. */
  requireFreshness?: boolean;
  maxAgeMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function classify<Q extends RetryableQuote>(
  quote: Q | null,
  options: { requireFreshness: boolean; maxAgeMs: number; now: number },
): QuoteFailure | null {
  if (!quote) return "no_quote";
  if (!validQuoteGeometry(Number(quote.bid), Number(quote.ask))) return "malformed_tick";
  if (!(Number(quote.ask) - Number(quote.bid) > 0)) return "zero_or_inverted_spread";
  if (!options.requireFreshness) return null;
  const parsed = quote.sourceTime ? Date.parse(quote.sourceTime) : Number.NaN;
  if (!Number.isFinite(parsed)) return "stale_source_time";
  if (parsed - options.now > 60_000) return "future_source_time";
  if (!quoteSourceFresh(quote.sourceTime, options.maxAgeMs, options.now)) return "stale_source_time";
  return null;
}

/**
 * Ask the provider for a usable quote, retrying a bounded number of times.
 * Every failure class is retried, because every one of them is observed to be
 * transient in production; what is never retried is the VERDICT — after the last
 * attempt the answer is a refusal.
 */
export async function fetchUsableQuote<Q extends RetryableQuote>(
  symbol: string,
  fetcher: (symbol: string) => Promise<Q | null>,
  options: UsableQuoteOptions = {},
): Promise<UsableQuoteOutcome<Q>> {
  const attemptsAllowed = Math.max(1, options.attempts ?? QUOTE_ATTEMPTS);
  const delayMs = options.delayMs ?? QUOTE_RETRY_DELAY_MS;
  const requireFreshness = options.requireFreshness ?? false;
  const maxAgeMs = options.maxAgeMs ?? Number.POSITIVE_INFINITY;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let attempts = 0;
  let failure: QuoteFailure = "no_quote";
  let thrown: string | null = null;

  while (attempts < attemptsAllowed) {
    attempts += 1;
    try {
      const quote = await fetcher(symbol);
      const verdict = classify(quote, { requireFreshness, maxAgeMs, now: now() });
      if (verdict === null && quote) {
        return {
          quote,
          attempts,
          failure: null,
          detail: `bid=${quote.bid}, ask=${quote.ask}, spread=${Number(quote.ask) - Number(quote.bid)}${
            attempts > 1 ? ` (usable on attempt ${attempts} of ${attemptsAllowed})` : ""
          }`,
        };
      }
      failure = verdict ?? "no_quote";
      thrown = null;
    } catch (err) {
      failure = "fetch_failed";
      thrown = err instanceof Error ? err.message : String(err);
    }
    if (attempts < attemptsAllowed) await sleep(delayMs);
  }

  const because = thrown ? `${FAILURE_TEXT[failure]}: ${thrown}` : FAILURE_TEXT[failure];
  return {
    quote: null,
    attempts,
    failure,
    detail: `${because} on all ${attempts} attempt${attempts === 1 ? "" : "s"}`,
  };
}
