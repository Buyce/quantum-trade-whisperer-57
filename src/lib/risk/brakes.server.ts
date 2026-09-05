/**
 * Reads the broker evidence a drawdown brake needs, evaluates it, and persists
 * the result as `account_risk_state`.
 *
 * Every number written here came from the broker: a closed trade's settled money
 * (`broker_trade_evidence.gross_profit + commission + swap`) and a broker equity
 * reading on the account row. Nothing is inferred from a plan, a journal entry or
 * an open position. When the evidence cannot be read at all, the state records
 * that fact and the brake refuses rather than passing.
 *
 * The equity high-water mark is accumulated forward from observations P-Trades has
 * actually seen — it is never back-filled from an assumed starting balance, and
 * the wording it produces says exactly that.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  brakesConfigured,
  evaluateBrakes,
  readBrakeLimits,
  summariseRealised,
  type BrakeLimits,
  type BrakeVerdict,
  type ClosedTrade,
  type RealisedTotals,
} from "./brakes";

/** How far back closed trades are read. Bounded: this runs on a request path. */
const LOOKBACK_DAYS = 21;
const MAX_TRADES = 500;

export interface BrakeAccount {
  id: string;
  user_id: string;
}

export interface AccountBrakeState {
  accountId: string;
  verdict: BrakeVerdict;
  totals: RealisedTotals | null;
  equity: number | null;
  peakEquity: number | null;
}

type SettingsLike = Parameters<typeof readBrakeLimits>[0];

interface StateRow {
  account_id: string;
  peak_equity: number | null;
  peak_equity_at: string | null;
}

const netOf = (row: {
  gross_profit: number | null;
  commission: number | null;
  swap: number | null;
}): number =>
  Number(row.gross_profit ?? 0) + Number(row.commission ?? 0) + Number(row.swap ?? 0);

/**
 * Evaluate the brakes for a set of armed accounts in one pass.
 *
 * Returns a map keyed by account id. An account whose owner configured no brake is
 * absent from the map — no read is paid for, and no state row is written.
 */
export async function evaluateAccountBrakes(
  db: SupabaseClient,
  accounts: readonly BrakeAccount[],
  settingsByUser: Map<string, SettingsLike>,
  nowMs: number,
): Promise<Map<string, AccountBrakeState>> {
  const out = new Map<string, AccountBrakeState>();

  const limitsByAccount = new Map<string, BrakeLimits>();
  for (const account of accounts) {
    const settings = settingsByUser.get(account.user_id);
    if (!settings) continue;
    const limits = readBrakeLimits(settings);
    if (brakesConfigured(limits)) limitsByAccount.set(account.id, limits);
  }
  if (limitsByAccount.size === 0) return out;

  const accountIds = [...limitsByAccount.keys()];
  const since = new Date(nowMs - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [evidence, accountRows, existingStates] = await Promise.all([
    db
      .from("broker_trade_evidence")
      .select("account_id, exit_at, gross_profit, commission, swap, profit_currency")
      .in("account_id", accountIds)
      .eq("state", "closed")
      .not("exit_at", "is", null)
      .gte("exit_at", since)
      .order("exit_at", { ascending: false })
      .limit(MAX_TRADES),
    db
      .from("connected_trading_accounts")
      .select("id, broker_equity, broker_observed_at")
      .in("id", accountIds),
    db.from("account_risk_state").select("account_id, peak_equity, peak_equity_at").in("account_id", accountIds),
  ]);

  // An unreadable history is NOT an empty history. Zero rows with no error means
  // "no closed trades in the window", which is a real measurement of zero loss.
  const evidenceReadable = !evidence.error;
  if (evidence.error) console.error("brakes: closed evidence unreadable", evidence.error.message);
  if (accountRows.error) console.error("brakes: accounts unreadable", accountRows.error.message);
  if (existingStates.error)
    console.error("brakes: risk state unreadable", existingStates.error.message);

  const tradesByAccount = new Map<string, ClosedTrade[]>();
  for (const row of (evidence.data ?? []) as {
    account_id: string;
    exit_at: string;
    gross_profit: number | null;
    commission: number | null;
    swap: number | null;
    profit_currency: string | null;
  }[]) {
    const exitAtMs = Date.parse(row.exit_at);
    if (!Number.isFinite(exitAtMs)) continue;
    const list = tradesByAccount.get(row.account_id) ?? [];
    list.push({ exitAtMs, net: netOf(row), currency: row.profit_currency ?? null });
    tradesByAccount.set(row.account_id, list);
  }

  const equityByAccount = new Map<string, { equity: number | null; observedAt: string | null }>();
  for (const row of (accountRows.data ?? []) as {
    id: string;
    broker_equity: number | null;
    broker_observed_at: string | null;
  }[]) {
    const equity =
      typeof row.broker_equity === "number" && Number.isFinite(row.broker_equity) && row.broker_equity > 0
        ? row.broker_equity
        : null;
    equityByAccount.set(row.id, { equity, observedAt: row.broker_observed_at ?? null });
  }

  const stateByAccount = new Map<string, StateRow>(
    ((existingStates.data ?? []) as StateRow[]).map((row) => [row.account_id, row]),
  );

  const upserts: Record<string, unknown>[] = [];

  for (const account of accounts) {
    const limits = limitsByAccount.get(account.id);
    if (!limits) continue;

    const totals = evidenceReadable
      ? summariseRealised(tradesByAccount.get(account.id) ?? [], nowMs)
      : null;
    const observed = equityByAccount.get(account.id) ?? { equity: null, observedAt: null };
    const prior = stateByAccount.get(account.id) ?? null;

    // High-water mark: the higher of what we stored and what the broker reports now.
    const storedPeak =
      prior && typeof prior.peak_equity === "number" && Number.isFinite(prior.peak_equity)
        ? prior.peak_equity
        : null;
    let peakEquity = storedPeak;
    let peakAt = prior?.peak_equity_at ?? null;
    if (observed.equity !== null && (peakEquity === null || observed.equity > peakEquity)) {
      peakEquity = observed.equity;
      peakAt = observed.observedAt ?? new Date(nowMs).toISOString();
    }

    const verdict = evaluateBrakes(limits, { totals, equity: observed.equity, peakEquity }, nowMs);
    out.set(account.id, {
      accountId: account.id,
      verdict,
      totals,
      equity: observed.equity,
      peakEquity,
    });

    const drawdownPercent =
      peakEquity !== null && peakEquity > 0 && observed.equity !== null
        ? Math.max(0, ((peakEquity - observed.equity) / peakEquity) * 100)
        : null;

    upserts.push({
      user_id: account.user_id,
      account_id: account.id,
      computed_at: new Date(nowMs).toISOString(),
      day_utc: totals?.dayUtc ?? null,
      day_realized: totals?.dayRealized ?? null,
      week_start_utc: totals?.weekStartUtc ?? null,
      week_realized: totals?.weekRealized ?? null,
      realized_currency: totals?.currency ?? null,
      consecutive_losses: totals?.consecutiveLosses ?? null,
      closed_sample: totals?.sample ?? 0,
      peak_equity: peakEquity,
      peak_equity_at: peakAt,
      current_equity: observed.equity,
      current_equity_at: observed.observedAt,
      drawdown_percent: drawdownPercent,
      measured: totals !== null && observed.equity !== null,
      unmeasured_reason:
        totals === null
          ? "closed broker trades could not be read"
          : observed.equity === null
            ? "the broker has not reported equity for this account"
            : null,
      paused: verdict.paused,
      pause_reason: verdict.reason,
      pause_detail: verdict.detail,
      paused_at: verdict.paused ? new Date(nowMs).toISOString() : null,
      resume_after: verdict.resumeAfterMs === null ? null : new Date(verdict.resumeAfterMs).toISOString(),
      resume_boundary: verdict.resumeBoundary,
    });
  }

  if (upserts.length > 0) {
    const { error } = await db.from("account_risk_state").upsert(upserts, { onConflict: "account_id" });
    // A failed write must never loosen the verdict already decided above.
    if (error) console.error("brakes: risk state not persisted", error.message);
  }

  return out;
}

/**
 * Single-account brake check for the pre-send path, where one delivery is about to
 * leave. Reuses the same evidence reader so the two boundaries cannot disagree.
 */
export async function accountBrakeVerdict(
  db: SupabaseClient,
  account: BrakeAccount,
  settings: SettingsLike,
  nowMs: number,
): Promise<BrakeVerdict | null> {
  const limits = readBrakeLimits(settings);
  if (!brakesConfigured(limits)) return null;
  const map = await evaluateAccountBrakes(
    db,
    [account],
    new Map([[account.user_id, settings]]),
    nowMs,
  );
  return map.get(account.id)?.verdict ?? null;
}
