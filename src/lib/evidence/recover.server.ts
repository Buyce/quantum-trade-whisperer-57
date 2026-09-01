/**
 * Orphan broker-evidence recovery.
 *
 * The retention purge used to delete signals — and cascade away the
 * `execution_deliveries` rows behind them — while the broker still held the real,
 * filled, closed trades those orders became. The reconciler associates deals by
 * delivery row, so those trades became invisible to P-Trades even though the
 * broker balance moved.
 *
 * This worker recovers them from the ONLY authority that still has them: the
 * broker's own deal history. It writes `broker_trade_evidence` rows straight from
 * broker figures, with `delivery_id` and `signal_id` left NULL because those
 * records are genuinely gone. Nothing is estimated: planned geometry that no
 * longer exists stays NULL, and R that cannot be computed from broker facts is
 * declared unavailable.
 *
 * It never writes to `executed_trades`, never resurrects a signal and never
 * touches a delivery row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeR, R_MATH_VERSION } from "@/lib/journal/r-math";
import { fetchDeals, fetchHistoryOrders } from "@/lib/metaapi/history.server";
import { fetchPositions } from "@/lib/metaapi/accounts.server";
import { isSafeResearchRef, newsContextFor, pooledInclusionAllowed } from "@/lib/research/consent";
import {
  evidenceClassFor,
  groupOwnedDeals,
  resolveBrokerStop,
  summariseGroup,
} from "./associate";
import { recoveredCharacterisationFields } from "./grade-recovery";
import { recoverCharacterisation } from "./grade-recovery.server";

type Db = Pick<SupabaseClient, "from">;

/** Default lookback. Bounded so one pass can never become unbounded history. */
export const RECOVERY_WINDOW_DAYS = 30;

/** Hard ceiling on evidence rows one pass may write. */
export const MAX_RECOVERIES_PER_RUN = 200;

interface AccountRow {
  id: string;
  user_id: string;
  metaapi_account_id: string | null;
  region: string;
  magic: number | null;
  broker_account_type: string | null;
  research_consent: boolean | null;
  research_consent_version: number | null;
  research_consent_at: string | null;
  research_account_ref: string | null;
}

export interface RecoveryResult {
  accountsChecked: number;
  groupsSeen: number;
  /** Groups whose delivery row still exists — left to the normal reconciler. */
  skippedWithDelivery: number;
  /** Groups whose evidence row already existed. */
  skippedExisting: number;
  recovered: number;
  errors: string[];
}

/**
 * Recover broker-confirmed trades that have no delivery row left.
 *
 * `benchmarkAccountId` classifies the provider's own account, exactly as the
 * reconciler does, so a customer row can never be counted as benchmark evidence.
 */
export async function recoverOrphanEvidence(
  db: SupabaseClient,
  options: { windowDays?: number; benchmarkAccountId?: string | null; now?: number } = {},
): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    accountsChecked: 0,
    groupsSeen: 0,
    skippedWithDelivery: 0,
    skippedExisting: 0,
    recovered: 0,
    errors: [],
  };
  const now = options.now ?? Date.now();
  const windowDays = Math.min(Math.max(options.windowDays ?? RECOVERY_WINDOW_DAYS, 1), 90);
  const start = new Date(now - windowDays * 86_400_000);

  const { data: accountRows, error: accountError } = await db
    .from("connected_trading_accounts")
    .select(
      "id, user_id, metaapi_account_id, region, magic, broker_account_type, research_consent, research_consent_version, research_consent_at, research_account_ref",
    )
    .not("metaapi_account_id", "is", null);
  if (accountError) {
    result.errors.push(`accounts unreadable: ${accountError.message}`);
    return result;
  }

  for (const account of (accountRows ?? []) as unknown as AccountRow[]) {
    if (!account.metaapi_account_id) continue;
    result.accountsChecked += 1;

    let deals;
    try {
      deals = await fetchDeals(account.metaapi_account_id, account.region, start, new Date(now));
    } catch (err) {
      result.errors.push(
        `${account.id}: broker history unavailable — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    // Broker-held stops, read once. Unavailable history leaves the stop unknown
    // rather than falling back to a submitted price we no longer have.
    let positions: Awaited<ReturnType<typeof fetchPositions>> = [];
    let historyOrders: Awaited<ReturnType<typeof fetchHistoryOrders>> = [];
    try {
      positions = await fetchPositions(account.metaapi_account_id, account.region);
    } catch {
      positions = [];
    }
    try {
      historyOrders = await fetchHistoryOrders(
        account.metaapi_account_id,
        account.region,
        start,
        new Date(now),
      );
    } catch {
      historyOrders = [];
    }

    const groups = groupOwnedDeals(deals, account.magic ?? null);
    result.groupsSeen += groups.length;
    const isBenchmark =
      !!options.benchmarkAccountId && options.benchmarkAccountId === account.metaapi_account_id;
    const evidenceClass = evidenceClassFor(isBenchmark);

    for (const group of groups) {
      if (result.recovered >= MAX_RECOVERIES_PER_RUN) return result;

      const { data: deliveryRow, error: deliveryError } = await db
        .from("execution_deliveries")
        .select("id")
        .eq("client_id", group.clientId)
        .maybeSingle();
      if (deliveryError) {
        result.errors.push(`${group.clientId}: deliveries unreadable — ${deliveryError.message}`);
        continue;
      }
      if (deliveryRow) {
        // The reconciler owns this one; recovery never competes with it.
        result.skippedWithDelivery += 1;
        continue;
      }

      const { data: existing, error: existingError } = await db
        .from("broker_trade_evidence")
        .select("id")
        .eq("client_id", group.clientId)
        .eq("metaapi_account_id", account.metaapi_account_id)
        .maybeSingle();
      if (existingError) {
        result.errors.push(`${group.clientId}: evidence unreadable — ${existingError.message}`);
        continue;
      }
      if (existing) {
        result.skippedExisting += 1;
        continue;
      }

      const summary = summariseGroup(group);
      const brokerStop = resolveBrokerStop(group, positions, historyOrders);
      const consent = pooledInclusionAllowed({
        researchConsent: account.research_consent,
        researchConsentVersion: account.research_consent_version,
        researchConsentAt: account.research_consent_at,
      });
      const researchRefAllowed =
        !isBenchmark &&
        consent.included &&
        isSafeResearchRef(account.research_account_ref, [
          account.id,
          account.user_id,
          account.metaapi_account_id,
        ]);

      // Direction comes from the broker's own entry deal, never from a guess.
      const entryDeal = group.deals.find(
        (d) => (d.entryType ?? "").toUpperCase() === "DEAL_ENTRY_IN",
      );
      const dealType = (entryDeal?.type ?? "").toUpperCase();
      const direction = dealType.includes("BUY")
        ? "long"
        : dealType.includes("SELL")
          ? "short"
          : null;

      // The plan behind this order was deleted with its delivery row, so plan-R
      // is genuinely unavailable. Only actual-risk R can be recovered.
      const r = computeR({
        outcome: summary.state === "closed" ? "win" : "open",
        direction,
        plannedEntry: null,
        plannedStop: null,
        actualEntryPrice: summary.entryPrice,
        actualExitPrice: summary.exitPrice,
        actualInitialStop: brokerStop.stop,
      });

      // The signal row is gone, but the decision log is not: instrument, grade
      // and the signal reference are recovered from it when — and only when —
      // the match is unambiguous.
      const characterisation = await recoverCharacterisation(db, {
        clientId: group.clientId,
        brokerSymbol: group.symbol ?? null,
        aroundIso: summary.entryAt,
      });

      const { error } = await db.from("broker_trade_evidence").insert({
        user_id: account.user_id,
        evidence_class: evidenceClass,
        evidence_phase: "development",
        news_context: newsContextFor(),
        research_consent: researchRefAllowed,
        research_account_ref: researchRefAllowed ? account.research_account_ref : null,
        account_id: account.id,
        metaapi_account_id: account.metaapi_account_id,
        // Both records were deleted by retention; they are not reconstructed.
        signal_id: null,
        delivery_id: null,
        client_id: group.clientId,
        magic: group.magic,
        association_basis: group.basis,
        broker_order_id: group.brokerOrderId,
        broker_position_id: group.brokerPositionId,
        broker_symbol: group.symbol ?? "unknown",
        direction,
        planned_entry: null,
        planned_stop: null,
        planned_target: null,
        actual_initial_stop: brokerStop.stop,
        stop_source: brokerStop.source,
        broker_account_type: account.broker_account_type,
        last_reconciled_at: new Date(now).toISOString(),
        volume: summary.volume,
        entry_price: summary.entryPrice,
        exit_price: summary.exitPrice,
        entry_at: summary.entryAt,
        exit_at: summary.exitAt,
        commission: summary.commission,
        swap: summary.swap,
        gross_profit: summary.grossProfit,
        r_vs_plan: r.rVsPlan,
        r_vs_actual_risk: r.rVsActualRisk,
        r_availability: r.availability,
        stop_provenance: r.stopProvenance,
        r_math_version: R_MATH_VERSION,
        // The submitted record was deleted with the delivery row, so there is no
        // published price to measure the broker's fill against.
        published_entry: null,
        slippage_price: null,
        slippage_availability: "unavailable_no_submitted_record",
        slippage_basis: null,
        deals: group.deals as unknown as Record<string, unknown>[],
        state: summary.state,
        resolved_at:
          summary.state === "closed" ? (summary.exitAt ?? new Date(now).toISOString()) : null,
      } as never);
      if (error) {
        result.errors.push(`${group.clientId}: recovery write failed — ${error.message}`);
        continue;
      }
      result.recovered += 1;
    }
  }

  return result;
}

/** Narrow type used by the worker route so it need not import the client type. */
export type RecoveryDb = Db;
