/**
 * Prompt 14 Stage 3 closure (C) — ACCOUNT-SCOPED contract specifications.
 *
 * A customer's broker is not our benchmark broker: contract size, volume step,
 * minimum volume and stops level are per-account facts. Direct execution
 * therefore sizes and validates against the specification fetched from THAT
 * account (`connected_account_specs`), never against the benchmark table and
 * never against the static contract table.
 *
 * Returns null when no usable row exists — the caller must refuse, not guess.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SPEC_MAX_AGE_MS,
  specFromRow,
  type BrokerSpecRow,
  type SizingSpec,
} from "@/lib/broker/specs";

type Db = Pick<SupabaseClient, "from">;

/** Age at which an account specification is no longer trusted for execution. */
export const ACCOUNT_SPEC_MAX_AGE_MS = SPEC_MAX_AGE_MS;

const COLUMNS =
  "broker_symbol, canonical_symbol, contract_size, tick_size, tick_value, point, point_source, digits, volume_min, volume_max, volume_step, volume_limit, stops_level, freeze_level, base_currency, profit_currency, margin_currency, trade_mode, calc_mode, fetched_at";

interface AccountSpecRowRaw {
  broker_symbol: string;
  canonical_symbol: string | null;
  [key: string]: unknown;
}

/**
 * The account's own specification for one canonical instrument.
 *
 * Looked up by canonical symbol so the caller never has to know the broker's
 * naming; the returned spec keeps the BROKER symbol as its `symbol`.
 */
export async function loadAccountSizingSpec(
  db: Db,
  accountId: string,
  canonicalSymbol: string,
): Promise<SizingSpec | null> {
  const { data } = await db
    .from("connected_account_specs" as never)
    .select(COLUMNS)
    .eq("account_id", accountId)
    .eq("canonical_symbol", canonicalSymbol)
    .maybeSingle();
  const raw = data as unknown as AccountSpecRowRaw | null;
  if (!raw) return null;

  const spec = specFromRow({ ...(raw as unknown as BrokerSpecRow), symbol: raw.broker_symbol });
  return spec;
}

/** TRUE when the account specification is too old to authorise an order. */
export function accountSpecStale(spec: SizingSpec, now = Date.now()): boolean {
  if (!spec.asOf) return true;
  const ms = Date.parse(spec.asOf);
  if (!Number.isFinite(ms)) return true;
  return now - ms > ACCOUNT_SPEC_MAX_AGE_MS;
}
