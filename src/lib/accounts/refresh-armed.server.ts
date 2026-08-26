/**
 * Scheduled refresh of ARMED broker accounts.
 *
 * WHY. An automatic order may only be sized from a RECENT broker equity
 * observation (`BROKER_EQUITY_MAX_AGE_MS`). Until now the only thing that ever
 * refreshed that observation was the pre-send preflight inside a dispatch pass,
 * so an account whose stored figures had gone stale could refuse orders before
 * the broker was ever asked. This job keeps the stored broker facts warm for the
 * small number of accounts that are actually armed.
 *
 * WHAT IT IS NOT. It authorises nothing, submits nothing, and relaxes nothing:
 * the fresh pre-send refresh in `refreshDirectPreflight` remains the authority
 * for every order, and a broker that does not answer still fails closed there.
 * Nothing here is written unless the broker itself reported it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAccountFacts } from "@/lib/metaapi/accounts.server";

/** Hard bound on how many accounts one pass may touch. */
export const REFRESH_MAX_ACCOUNTS = 10;

export interface ArmedRefreshOutcome {
  considered: number;
  refreshed: number;
  failed: number;
  results: { accountId: string; ok: boolean; detail: string | null }[];
}

interface ArmedAccountRow {
  id: string;
  metaapi_account_id: string | null;
  region: string;
}

export async function refreshArmedAccounts(
  db: SupabaseClient,
  maxAccounts: number = REFRESH_MAX_ACCOUNTS,
): Promise<ArmedRefreshOutcome> {
  const outcome: ArmedRefreshOutcome = { considered: 0, refreshed: 0, failed: 0, results: [] };

  const { data, error } = await db
    .from("connected_trading_accounts")
    .select("id, metaapi_account_id, region")
    .is("disconnected_at", null)
    .in("mode", ["demo_auto", "live_auto"])
    .in("phase", ["connected", "ready"])
    // Oldest observation first, so a bounded pass always helps the account that
    // needs it most rather than re-reading the freshest one.
    .order("broker_observed_at", { ascending: true, nullsFirst: true })
    .limit(maxAccounts);
  if (error) {
    console.error("[refresh-armed] accounts unreadable", error.message);
    return outcome;
  }

  const accounts = ((data ?? []) as ArmedAccountRow[]).filter((a) => a.metaapi_account_id);
  outcome.considered = accounts.length;

  for (const account of accounts) {
    try {
      const facts = await fetchAccountFacts(account.metaapi_account_id as string, account.region);
      if (!facts) {
        outcome.failed += 1;
        outcome.results.push({
          accountId: account.id,
          ok: false,
          detail: "the broker returned no account information",
        });
        continue;
      }
      const info = facts.info as {
        tradeAllowed?: boolean | null;
        investorMode?: boolean | null;
        freeMargin?: number | null;
        equity?: number | null;
        currency?: string | null;
      };
      await db
        .from("connected_trading_accounts")
        .update({
          broker_account_type: facts.type,
          trade_allowed: info.tradeAllowed ?? null,
          investor_mode: typeof info.investorMode === "boolean" ? info.investorMode : null,
          broker_free_margin:
            typeof info.freeMargin === "number" && Number.isFinite(info.freeMargin)
              ? info.freeMargin
              : null,
          broker_equity:
            typeof info.equity === "number" && Number.isFinite(info.equity) ? info.equity : null,
          ...(typeof info.currency === "string" && info.currency.trim()
            ? { account_currency: info.currency.trim() }
            : {}),
          broker_observed_at: facts.observedAt,
        } as never)
        .eq("id", account.id);
      outcome.refreshed += 1;
      outcome.results.push({ accountId: account.id, ok: true, detail: null });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      outcome.failed += 1;
      outcome.results.push({ accountId: account.id, ok: false, detail });
    }
  }

  return outcome;
}
