/**
 * Symbol-mapping AUTHORITY (Phase A1, Finding 5).
 *
 * The defect this closes: `readiness.server.ts` proved "mapping" by checking that
 * a row existed in `broker_symbol_specs`. A stored specification is evidence that
 * SOME symbol was fetched at SOME time — it is not evidence that the canonical
 * name resolves to exactly one broker symbol, and it carries no scope, so a spec
 * fetched from the benchmark account was silently treated as proof for every
 * account.
 *
 * MAPPING ≠ SPECIFICATION
 *   mapping       — WHICH broker symbol a canonical instrument means, for WHICH
 *                   account/server, verified WHEN, and how confidently.
 *   specification — the numeric facts (digits, point, tick, lot bounds) about a
 *                   symbol once its name is already known.
 *
 * The pure resolver already exists and already refuses to guess
 * (`@/lib/accounts/symbol-map`). This module is the persisted, scoped, time-aware
 * answer built on top of it.
 *
 * FAIL CLOSED: `ambiguous`, `unavailable`, `unverified` and `stale` are all
 * unusable. Only `exact` and `configured` inside the freshness window may be used
 * by readiness, by a quote/candle request or by an order.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRegistrySymbol } from "./registry";

/**
 * Confidence of a resolution.
 *   exact       — the broker publishes the canonical name verbatim.
 *   configured  — resolved through the broker's own naming suffix (`XAUUSD.a`),
 *                 recorded once per account and reused.
 *   inferred    — derived, not confirmed against a live broker symbol list.
 *   ambiguous   — more than one plausible broker symbol; refuse, never guess.
 *   unavailable — the broker does not offer the instrument on this account.
 *   unverified  — no resolution has ever been recorded for this scope.
 */
export type MappingStatus =
  "exact" | "configured" | "inferred" | "ambiguous" | "unavailable" | "unverified";

export interface MappingScope {
  /** Connected account the mapping belongs to, or null for the scanner scope. */
  accountId: string | null;
  /** Broker server name when known. Never a token, never an account login. */
  server: string | null;
}

export interface MappingResolution {
  canonical: string;
  providerSymbol: string | null;
  status: MappingStatus;
  scope: MappingScope;
  verifiedAt: string | null;
  /** Every plausible broker symbol considered; populated for `ambiguous`. */
  candidates: string[];
  /** True only when this mapping may be used for data, sizing or an order. */
  usable: boolean;
  /** Machine-readable refusal, null when usable. */
  refusal: MappingRefusal | null;
  /** One customer-safe sentence. Contains no account id, server or payload. */
  detail: string;
}

export type MappingRefusal =
  | "not_in_registry"
  | "never_verified"
  | "ambiguous_broker_symbols"
  | "not_offered_by_broker"
  | "verification_stale"
  | "inferred_not_confirmed";

/**
 * A mapping older than this must be re-verified before it may be used.
 *
 * Brokers rename, retire and re-list symbols. Thirty days is long enough that a
 * healthy account never re-resolves during normal operation, and short enough
 * that a renamed symbol cannot silently route an order for a whole quarter.
 */
export const MAPPING_MAX_AGE_MS = 30 * 24 * 3_600_000;

const USABLE: MappingStatus[] = ["exact", "configured"];

/** Persisted `mapping_kind` values -> the authority's status vocabulary. */
function statusFromKind(kind: string | null | undefined): MappingStatus {
  switch (kind) {
    case "exact":
      return "exact";
    case "suffix":
      return "configured";
    case "ambiguous":
      return "ambiguous";
    case "unavailable":
      return "unavailable";
    default:
      return "unverified";
  }
}

function refuse(
  canonical: string,
  scope: MappingScope,
  status: MappingStatus,
  refusal: MappingRefusal,
  detail: string,
  extra?: { verifiedAt?: string | null; candidates?: string[]; providerSymbol?: string | null },
): MappingResolution {
  return {
    canonical,
    providerSymbol: extra?.providerSymbol ?? null,
    status,
    scope,
    verifiedAt: extra?.verifiedAt ?? null,
    candidates: extra?.candidates ?? [],
    usable: false,
    refusal,
    detail,
  };
}

interface SymbolRow {
  canonical_symbol: string;
  broker_symbol: string | null;
  mapping_kind: string | null;
  candidates: string[] | null;
  resolved_at: string | null;
}

/**
 * The scoped, time-aware answer for one canonical instrument.
 *
 * `accountId === null` is the SCANNER scope: the scanner reads candles for the
 * canonical name from the benchmark data account, so the canonical name is the
 * provider symbol — but only for registry symbols, and only when a specification
 * row proves that name was actually accepted by the provider. That specification
 * check is a NAME-EXISTENCE proof here, which is a much narrower claim than the
 * old readiness check made.
 */
export async function resolveMapping(
  db: SupabaseClient,
  args: { canonical: string; accountId?: string | null; server?: string | null; now?: Date },
): Promise<MappingResolution> {
  const canonical = args.canonical.trim().toUpperCase();
  const scope: MappingScope = {
    accountId: args.accountId ?? null,
    server: args.server ?? null,
  };
  const now = args.now ?? new Date();

  if (!isRegistrySymbol(canonical)) {
    return refuse(
      canonical,
      scope,
      "unverified",
      "not_in_registry",
      "This instrument is not in the P-Trades instrument registry.",
    );
  }

  if (scope.accountId === null) {
    return await resolveScannerScope(db, canonical, scope, now);
  }

  const { data, error } = await db
    .from("connected_account_symbols")
    .select("canonical_symbol, broker_symbol, mapping_kind, candidates, resolved_at")
    .eq("account_id", scope.accountId)
    .eq("canonical_symbol", canonical)
    .maybeSingle();

  if (error || !data) {
    return refuse(
      canonical,
      scope,
      "unverified",
      "never_verified",
      "This account's symbol list has not been resolved for this instrument yet.",
    );
  }

  const row = data as unknown as SymbolRow;
  const status = statusFromKind(row.mapping_kind);
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];

  if (status === "ambiguous") {
    return refuse(
      canonical,
      scope,
      status,
      "ambiguous_broker_symbols",
      `Your broker offers more than one symbol that could be this instrument (${candidates.join(", ")}). P-Trades will not choose between them.`,
      { verifiedAt: row.resolved_at, candidates },
    );
  }
  if (status === "unavailable") {
    return refuse(
      canonical,
      scope,
      status,
      "not_offered_by_broker",
      "Your broker does not offer this instrument on this account.",
      { verifiedAt: row.resolved_at },
    );
  }
  if (status === "unverified" || !row.broker_symbol) {
    return refuse(
      canonical,
      scope,
      "unverified",
      "never_verified",
      "No confirmed broker symbol has been recorded for this instrument yet.",
      { verifiedAt: row.resolved_at },
    );
  }

  const staleness = stalenessOf(row.resolved_at, now);
  if (staleness !== null) {
    return refuse(
      canonical,
      scope,
      status,
      "verification_stale",
      `The broker symbol for this instrument was last confirmed ${staleness} days ago and must be re-checked before use.`,
      { verifiedAt: row.resolved_at, providerSymbol: row.broker_symbol, candidates },
    );
  }

  return {
    canonical,
    providerSymbol: row.broker_symbol,
    status,
    scope,
    verifiedAt: row.resolved_at,
    candidates,
    usable: USABLE.includes(status),
    refusal: null,
    detail:
      status === "exact"
        ? "Your broker publishes this instrument under its canonical name."
        : "Your broker publishes this instrument under its own naming suffix.",
  };
}

/**
 * Scanner scope. No per-account row exists, so the only honest evidence that the
 * canonical name is a real provider symbol is a specification fetched under that
 * exact name, plus how long ago it was fetched.
 */
async function resolveScannerScope(
  db: SupabaseClient,
  canonical: string,
  scope: MappingScope,
  now: Date,
): Promise<MappingResolution> {
  const { data, error } = await db
    .from("broker_symbol_specs")
    .select("symbol, fetched_at")
    .eq("symbol", canonical)
    .maybeSingle();

  if (error || !data) {
    return refuse(
      canonical,
      scope,
      "unverified",
      "never_verified",
      "The data provider has never returned a specification under this instrument's canonical name.",
    );
  }

  const row = data as { symbol: string; fetched_at: string | null };
  const staleness = stalenessOf(row.fetched_at, now);
  if (staleness !== null) {
    return refuse(
      canonical,
      scope,
      "exact",
      "verification_stale",
      `The provider last confirmed this instrument's name ${staleness} days ago; it must be re-checked before use.`,
      { verifiedAt: row.fetched_at, providerSymbol: row.symbol },
    );
  }

  return {
    canonical,
    providerSymbol: row.symbol,
    status: "exact",
    scope,
    verifiedAt: row.fetched_at,
    candidates: [row.symbol],
    usable: true,
    refusal: null,
    detail: "The data provider accepts this instrument under its canonical name.",
  };
}

/** Days stale, or null when inside the window. A missing timestamp is stale. */
function stalenessOf(at: string | null | undefined, now: Date): number | null {
  if (!at) return Number.POSITIVE_INFINITY as unknown as number;
  const ms = now.getTime() - new Date(at).getTime();
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY as unknown as number;
  if (ms <= MAPPING_MAX_AGE_MS) return null;
  return Math.floor(ms / (24 * 3_600_000));
}
