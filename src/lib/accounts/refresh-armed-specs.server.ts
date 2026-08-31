/**
 * Scheduled refresh of the CONTRACT SPECIFICATIONS of armed broker accounts.
 *
 * WHY. A direct automatic order is sized from the destination account's own
 * specification (`connected_account_specs`) and refuses when that row is older
 * than `ACCOUNT_SPEC_MAX_AGE_MS` (36 hours). Those rows were only ever written
 * at connection time or by a MANUAL broker-account refresh, so every armed
 * account eventually aged out and then refused every order — verified in
 * production as a run of `account_spec_unavailable` refusals.
 *
 * WHAT IT IS NOT. It authorises nothing and submits nothing, and it relaxes no
 * gate: the 36-hour bound stays exactly as it is. Nothing is written unless the
 * broker itself returned it, and a broker that cannot be reached leaves the
 * stored row untouched so the order still fails closed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchTypedSymbolSpecification } from "@/lib/metaapi/specs.server";

import { buildAccountSpecRow, needsSpecRefresh, SPEC_REFRESH_AFTER_MS } from "./spec-row";

/** Hard bound on how many accounts one pass may touch. */
export const SPEC_REFRESH_MAX_ACCOUNTS = 5;
/** Hard bound on broker specification reads per account per pass. */
export const SPEC_REFRESH_MAX_SYMBOLS = 12;

export interface SpecRefreshOutcome {
  considered: number;
  refreshed: number;
  skippedFresh: number;
  failed: number;
  symbolsWritten: number;
  results: { accountId: string; ok: boolean; written: number; detail: string | null }[];
}

interface ArmedAccountRow {
  id: string;
  user_id: string;
  metaapi_account_id: string | null;
  region: string;
  platform: string | null;
}

interface SymbolRow {
  canonical_symbol: string;
  broker_symbol: string | null;
}

export async function refreshArmedAccountSpecs(
  db: SupabaseClient,
  now = Date.now(),
  maxAccounts: number = SPEC_REFRESH_MAX_ACCOUNTS,
): Promise<SpecRefreshOutcome> {
  const outcome: SpecRefreshOutcome = {
    considered: 0,
    refreshed: 0,
    skippedFresh: 0,
    failed: 0,
    symbolsWritten: 0,
    results: [],
  };

  const { data, error } = await db
    .from("connected_trading_accounts")
    .select("id, user_id, metaapi_account_id, region, platform")
    .is("disconnected_at", null)
    .in("mode", ["demo_auto", "live_auto"])
    .in("phase", ["connected", "ready"])
    .limit(maxAccounts);
  if (error) {
    console.error("[refresh-account-specs] accounts unreadable", error.message);
    return outcome;
  }

  const accounts = ((data ?? []) as ArmedAccountRow[]).filter((a) => a.metaapi_account_id);
  outcome.considered = accounts.length;

  for (const account of accounts) {
    try {
      const { data: symbolRows, error: symbolError } = await db
        .from("connected_account_symbols")
        .select("canonical_symbol, broker_symbol")
        .eq("account_id", account.id);
      if (symbolError) throw new Error(symbolError.message);
      const mapped = ((symbolRows ?? []) as SymbolRow[]).filter((r) => r.broker_symbol);

      const { data: specRows, error: specError } = await db
        .from("connected_account_specs")
        .select("canonical_symbol, fetched_at")
        .eq("account_id", account.id)
        .order("fetched_at", { ascending: false });
      if (specError) throw new Error(specError.message);
      const stored = (specRows ?? []) as { canonical_symbol: string | null; fetched_at: string }[];

      const due = needsSpecRefresh(
        {
          newestFetchedAt: stored[0]?.fetched_at ?? null,
          storedSymbols: stored.length,
          mappedSymbols: mapped.length,
        },
        now,
        SPEC_REFRESH_AFTER_MS,
      );
      if (!due) {
        outcome.skippedFresh += 1;
        outcome.results.push({ accountId: account.id, ok: true, written: 0, detail: "fresh" });
        continue;
      }

      let written = 0;
      let lastFailure: string | null = null;
      for (const row of mapped.slice(0, SPEC_REFRESH_MAX_SYMBOLS)) {
        try {
          const spec = await fetchTypedSymbolSpecification(
            account.metaapi_account_id as string,
            account.region,
            row.broker_symbol as string,
          );
          if (!spec) {
            lastFailure = `${row.canonical_symbol}: the broker returned no specification`;
            continue;
          }
          const { error: writeError } = await db.from("connected_account_specs").upsert(
            buildAccountSpecRow({
              accountId: account.id,
              userId: account.user_id,
              brokerSymbol: row.broker_symbol as string,
              canonicalSymbol: row.canonical_symbol,
              platform: account.platform ?? "unknown",
              spec,
              fetchedAt: new Date(now).toISOString(),
            }) as never,
            { onConflict: "account_id,broker_symbol" },
          );
          if (writeError) throw new Error(writeError.message);
          written += 1;
        } catch (err) {
          lastFailure = `${row.canonical_symbol}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      outcome.symbolsWritten += written;
      if (written > 0) {
        outcome.refreshed += 1;
        outcome.results.push({ accountId: account.id, ok: true, written, detail: lastFailure });
      } else {
        outcome.failed += 1;
        outcome.results.push({
          accountId: account.id,
          ok: false,
          written: 0,
          detail: lastFailure ?? "no mapped broker symbols to refresh",
        });
      }
    } catch (err) {
      outcome.failed += 1;
      outcome.results.push({
        accountId: account.id,
        ok: false,
        written: 0,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outcome;
}

/**
 * Bounded re-read of ONE account/instrument specification, used by dispatch when
 * a delivery would otherwise be refused purely because the stored row aged out.
 * Returns TRUE only when the broker itself answered and the row was rewritten.
 */
export async function refreshAccountSpecForInstrument(
  db: SupabaseClient,
  account: { id: string; userId: string; metaapiAccountId: string; region: string; platform: string | null },
  canonicalSymbol: string,
  now = Date.now(),
): Promise<boolean> {
  try {
    const { data } = await db
      .from("connected_account_symbols")
      .select("canonical_symbol, broker_symbol")
      .eq("account_id", account.id)
      .eq("canonical_symbol", canonicalSymbol)
      .maybeSingle();
    const row = data as SymbolRow | null;
    if (!row?.broker_symbol) return false;

    const spec = await fetchTypedSymbolSpecification(
      account.metaapiAccountId,
      account.region,
      row.broker_symbol,
    );
    if (!spec) return false;

    const { error } = await db.from("connected_account_specs").upsert(
      buildAccountSpecRow({
        accountId: account.id,
        userId: account.userId,
        brokerSymbol: row.broker_symbol,
        canonicalSymbol: canonicalSymbol,
        platform: account.platform ?? "unknown",
        spec,
        fetchedAt: new Date(now).toISOString(),
      }) as never,
      { onConflict: "account_id,broker_symbol" },
    );
    return !error;
  } catch {
    return false;
  }
}
