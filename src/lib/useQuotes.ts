import { useEffect, useState } from "react";

export interface Quote {
  instrument: string;
  bid: number;
  ask: number;
  mid: number;
  at: string;
}

/**
 * Polls the shared, edge-cached /api/public/quotes endpoint. Every client hits
 * the same cached response, so the broker sees one call per TTL no matter how
 * many terminals are open. On failure the map stays empty and the UI shows "—"
 * rather than an estimated price.
 *
 * Display only: FX conversion for position sizing is resolved per request by the
 * authenticated sizing service, not carried on this public endpoint.
 */
export function useQuotes(enabled = true, intervalMs = 20_000) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/public/quotes");
        if (!res.ok) return;
        const body = (await res.json()) as { quotes?: Quote[] };
        if (cancelled) return;
        const next: Record<string, Quote> = {};
        for (const q of body.quotes ?? []) next[q.instrument] = q;
        setQuotes(next);
      } catch {
        // Silent: a missing quote degrades to "—", never to a guessed price.
      }
    }

    void load();
    const id = setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, intervalMs]);

  return { quotes };
}
