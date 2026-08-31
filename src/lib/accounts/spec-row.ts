/**
 * Pure mapping from a broker symbol specification to a
 * `connected_account_specs` row.
 *
 * Extracted so that BOTH the connection-time symbol map and the scheduled
 * freshness job write byte-identical rows: an account specification must mean
 * exactly the same thing whoever fetched it. Nothing is defaulted — a field the
 * broker omits stays NULL so a later check reports "unknown" instead of "pass".
 */

export interface BrokerSymbolSpecLike {
  contractSize?: number | null;
  tickSize?: number | null;
  point?: number | null;
  digits?: number | null;
  minVolume?: number | null;
  maxVolume?: number | null;
  volumeStep?: number | null;
  volumeLimit?: number | null;
  stopsLevel?: number | null;
  freezeLevel?: number | null;
  baseCurrency?: string | null;
  profitCurrency?: string | null;
}

export interface AccountSpecRowInput {
  accountId: string;
  userId: string;
  brokerSymbol: string;
  canonicalSymbol: string;
  platform: string;
  spec: BrokerSymbolSpecLike;
  fetchedAt: string;
}

export function buildAccountSpecRow(input: AccountSpecRowInput): Record<string, unknown> {
  const { spec } = input;
  const digits = Number.isFinite(Number(spec.digits)) ? Number(spec.digits) : null;
  const brokerPoint = Number.isFinite(Number(spec.point));
  const point = brokerPoint ? Number(spec.point) : digits !== null ? 10 ** -digits : null;
  return {
    account_id: input.accountId,
    user_id: input.userId,
    broker_symbol: input.brokerSymbol,
    canonical_symbol: input.canonicalSymbol,
    contract_size: spec.contractSize ?? null,
    tick_size: spec.tickSize ?? null,
    point,
    point_source: brokerPoint ? "broker_point" : digits !== null ? "derived_from_digits" : null,
    digits,
    volume_min: spec.minVolume ?? null,
    volume_max: spec.maxVolume ?? null,
    volume_step: spec.volumeStep ?? null,
    volume_limit: spec.volumeLimit ?? null,
    stops_level: spec.stopsLevel ?? null,
    freeze_level: spec.freezeLevel ?? null,
    base_currency: spec.baseCurrency ?? null,
    profit_currency: spec.profitCurrency ?? null,
    raw: { ...spec, platform: input.platform } as unknown,
    fetched_at: input.fetchedAt,
  };
}

/** Age at or beyond which the scheduled job re-reads an account specification. */
export const SPEC_REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

export interface SpecFreshnessInput {
  /** Most recent `fetched_at` stored for this account, null when none exists. */
  newestFetchedAt: string | null;
  /** Number of canonical instruments the account has a specification for. */
  storedSymbols: number;
  /** Number of canonical instruments the account has a broker mapping for. */
  mappedSymbols: number;
}

/**
 * TRUE when an armed account's specifications should be re-read now: they are
 * older than the refresh age, unreadable, absent, or do not cover every mapped
 * symbol. Deliberately well inside the 36-hour execution trust bound, so a
 * missed pass cannot silently block orders.
 */
export function needsSpecRefresh(
  input: SpecFreshnessInput,
  now = Date.now(),
  refreshAfterMs = SPEC_REFRESH_AFTER_MS,
): boolean {
  if (input.storedSymbols === 0) return true;
  if (input.mappedSymbols > input.storedSymbols) return true;
  if (!input.newestFetchedAt) return true;
  const ms = Date.parse(input.newestFetchedAt);
  if (!Number.isFinite(ms)) return true;
  return now - ms >= refreshAfterMs;
}
