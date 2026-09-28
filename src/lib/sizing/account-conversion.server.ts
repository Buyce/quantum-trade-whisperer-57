/** Conversion quotes for an order must come from its destination broker account. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapSymbol } from "@/lib/accounts/symbol-map";
import { fetchQuoteFor } from "@/lib/metaapi/market.server";
import { fetchSymbols } from "@/lib/metaapi/specs.server";
import { resolveConversion, type TimedQuoteFetcher } from "./conversion.server";

type Db = Pick<SupabaseClient, "from">;

/**
 * Resolve the canonical FX leg against this account's published symbol list.
 * A missing or ambiguous leg supplies no rate; resolveConversion then refuses
 * to size. Neither another broker nor a guessed suffix may back an order.
 */
export async function resolveAccountConversion(
  db: Db,
  userId: string,
  accountId: string,
  quoteCurrency: string,
  accountCurrency: string,
  now = Date.now(),
  sources: { symbols: typeof fetchSymbols; quote: typeof fetchQuoteFor } = {
    symbols: fetchSymbols,
    quote: fetchQuoteFor,
  },
) {
  let symbols: string[] | null = null;
  let connection: { metaapi_account_id: string; region: string } | null = null;
  const fetchLeg: TimedQuoteFetcher = async (canonical) => {
    if (symbols === null) {
      const { data, error } = await db
        .from("connected_trading_accounts")
        .select("metaapi_account_id, region")
        .eq("id", accountId)
        .eq("user_id", userId)
        .is("disconnected_at", null)
        .maybeSingle();
      const row = data as { metaapi_account_id?: string; region?: string } | null;
      if (error || !row?.metaapi_account_id || !row.region) return null;
      connection = { metaapi_account_id: row.metaapi_account_id, region: row.region };
      symbols = await sources.symbols(connection.metaapi_account_id, connection.region);
    }
    if (!connection) return null;
    const mapping = mapSymbol(canonical, symbols);
    if (!mapping.brokerSymbol || mapping.kind === "ambiguous") return null;
    return sources.quote(connection.metaapi_account_id, connection.region, mapping.brokerSymbol);
  };
  return resolveConversion(quoteCurrency, accountCurrency, fetchLeg, now);
}
