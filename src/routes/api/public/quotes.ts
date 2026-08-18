/**
 * Shared live-quote endpoint.
 *
 * One upstream MetaApi call per instrument per TTL, regardless of how many
 * clients are watching: the response is cached in the worker instance AND
 * marked publicly cacheable so the edge absorbs the fan-out. A per-client
 * MetaApi poll would multiply broker requests by user count and hit rate limits.
 *
 * Read-only market data only — no user data, so it is safe under /api/public.
 */
import { createFileRoute } from "@tanstack/react-router";
import { fetchQuote } from "@/lib/scanner/metaapi.server";
import { INSTRUMENTS } from "@/lib/scanner/types";

const TTL_MS = 15_000;

/**
 * FX pairs fetched purely to convert a setup's risk into the user's account
 * currency (GBPAUD risk lands in AUD, not USD). Deliberately separate from
 * INSTRUMENTS: these are never scanned, graded or published as setups.
 */
const CONVERSION_SYMBOLS = ["AUDUSD", "GBPUSD"] as const;

interface Quote {
  instrument: string;
  bid: number;
  ask: number;
  mid: number;
  at: string;
}

let cache: { at: number; quotes: Quote[]; rates: Record<string, number> } | null = null;

export const Route = createFileRoute("/api/public/quotes")({
  server: {
    handlers: {
      GET: async () => {
        if (!cache || Date.now() - cache.at > TTL_MS) {
          const quotes: Quote[] = [];
          for (const instrument of INSTRUMENTS) {
            try {
              const q = await fetchQuote(instrument);
              if (q) {
                quotes.push({
                  instrument,
                  bid: q.bid,
                  ask: q.ask,
                  mid: (q.bid + q.ask) / 2,
                  at: q.time,
                });
              }
            } catch (err) {
              // A single unavailable symbol must not blank the whole response.
              console.error("[quotes] fetch failed", instrument, err);
            }
          }

          // Conversion rates are best-effort: a missing one makes the risk panel
          // say so, and must never hold up or blank the tradable quotes.
          const rates: Record<string, number> = {};
          for (const symbol of CONVERSION_SYMBOLS) {
            try {
              const q = await fetchQuote(symbol);
              if (q) rates[symbol] = (q.bid + q.ask) / 2;
            } catch (err) {
              console.error("[quotes] conversion rate fetch failed", symbol, err);
            }
          }

          // Never cache an all-empty result: that would pin the outage for 15s.
          if (quotes.length) cache = { at: Date.now(), quotes, rates };
          else
            return new Response(JSON.stringify({ quotes: [], rates }), {
              status: 200,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            });
        }

        return new Response(JSON.stringify({ quotes: cache.quotes, rates: cache.rates }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=15",
          },
        });
      },
    },
  },
});
