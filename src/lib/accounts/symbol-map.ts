/**
 * Canonical instrument → this broker's own symbol name.
 *
 * Brokers rename the same instrument freely: `XAUUSD`, `XAUUSD.a`, `XAUUSDm`,
 * `GOLD`. Sizing, execution and reconciliation must all address the symbol the
 * broker itself publishes, so the mapping is resolved ONCE per connected
 * account from the broker's own symbol list.
 *
 * The three refusals matter more than the matches:
 *  - `ambiguous`   — several plausible broker symbols; a guess could place an
 *                    order on the wrong instrument, so we stop and ask.
 *  - `unavailable` — the broker does not offer the instrument at all.
 *  - a 3-letter currency-code remainder is NEVER treated as a suffix, because
 *    `GBPAUD` vs `GBPAUDUSD` are different instruments, not skins.
 *
 * Pure: no fetch, no env, no clock.
 */

export type SymbolMappingKind = "exact" | "suffix" | "ambiguous" | "unavailable";

export interface SymbolMapping {
  canonical: string;
  /** The broker's symbol, or null for `ambiguous` / `unavailable`. */
  brokerSymbol: string | null;
  kind: SymbolMappingKind;
  /** Every plausible broker symbol considered, always populated for ambiguity. */
  candidates: string[];
}

/** Separator + alphanumeric tag, e.g. `.a`, `-pro`, `_ecn`, `m`, `.raw`. */
const SUFFIX_RE = /^[._-]?[A-Za-z0-9]{1,8}$/;

/**
 * ISO-4217 codes P-Trades' instruments are built from. A remainder equal to one
 * of these means a DIFFERENT instrument, never a broker suffix.
 */
const CURRENCY_CODES = new Set([
  "AUD",
  "CAD",
  "CHF",
  "CNH",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "JPY",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
]);

function normalise(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** TRUE when `remainder` is a broker decoration rather than more instrument. */
export function isBrokerSuffix(remainder: string): boolean {
  if (remainder.length === 0) return false;
  if (!SUFFIX_RE.test(remainder)) return false;
  const bare = remainder.replace(/^[._-]/, "").toUpperCase();
  return !CURRENCY_CODES.has(bare);
}

/**
 * Resolve one canonical instrument against a broker's published symbol list.
 * `brokerSymbols` must come from the broker (Client API), never from a user.
 */
export function mapSymbol(canonical: string, brokerSymbols: readonly string[]): SymbolMapping {
  const target = normalise(canonical);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of brokerSymbols) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }

  const exact = unique.find((s) => normalise(s) === target);
  if (exact) {
    return { canonical: target, brokerSymbol: exact, kind: "exact", candidates: [exact] };
  }

  const candidates = unique.filter((s) => {
    const upper = normalise(s);
    return upper.startsWith(target) && isBrokerSuffix(upper.slice(target.length));
  });

  if (candidates.length === 1) {
    return {
      canonical: target,
      brokerSymbol: candidates[0]!,
      kind: "suffix",
      candidates,
    };
  }
  if (candidates.length > 1) {
    return { canonical: target, brokerSymbol: null, kind: "ambiguous", candidates };
  }
  return { canonical: target, brokerSymbol: null, kind: "unavailable", candidates: [] };
}

export function mapSymbols(
  canonicals: readonly string[],
  brokerSymbols: readonly string[],
): SymbolMapping[] {
  return canonicals.map((c) => mapSymbol(c, brokerSymbols));
}

/** Human sentence for one mapping. Never implies a guess was made. */
export function describeMapping(mapping: SymbolMapping): string {
  switch (mapping.kind) {
    case "exact":
      return `Your broker lists this instrument as ${mapping.brokerSymbol} — an exact name match.`;
    case "suffix":
      return `Your broker lists this instrument as ${mapping.brokerSymbol} (its own naming suffix).`;
    case "ambiguous":
      return `Your broker offers several symbols that could be this instrument (${mapping.candidates.join(", ")}). P-Trades will not guess between them — pick one before this instrument is used.`;
    case "unavailable":
      return "Your broker does not appear to offer this instrument on this account.";
  }
}

/** A mapping is usable downstream only when the broker's own name is known. */
export function isMappingUsable(mapping: SymbolMapping): boolean {
  return (
    (mapping.kind === "exact" || mapping.kind === "suffix") && typeof mapping.brokerSymbol === "string"
  );
}
