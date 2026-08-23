/**
 * Prompt 14 Stage 4 — the broker evidence reconciliation worker.
 *
 * Standalone by design: it reads broker history for accounts that P-Trades
 * actually submitted orders to, associates deals POSITIVELY by clientId (and
 * magic where reported), and records the result in `broker_trade_evidence`.
 *
 * It never writes to `executed_trades` (self-reported journal), never publishes
 * a signal, never touches a statistic, and never invents a price. If the broker
 * says nothing, nothing is written.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchDeals } from "@/lib/metaapi/history.server";
import { computeR, R_MATH_VERSION } from "@/lib/journal/r-math";
import {
  evidenceClassFor,
  groupOwnedDeals,
  summariseGroup,
  type DealGroup,
} from "./associate";

type Db = Pick<SupabaseClient, "from" | "rpc">;

/** How far back broker history is read on each pass. */
export const RECONCILE_WINDOW_HOURS = 72;

/** Delivery states worth reconciling: something may exist at the broker. */
const SUBMITTED_STATES = ["sent", "acknowledged", "unknown"] as const;

interface DeliveryRow {
  id: number;
  user_id: string;
  signal_id: string;
  connected_account_id: string;
  client_id: string | null;
  magic: number | null;
  broker_symbol: string | null;
  submitted_entry: number | null;
  submitted_stop: number | null;
  submitted_target: number | null;
  account_mode: string | null;
}

interface AccountRow {
  id: string;
  user_id: string;
  metaapi_account_id: string | null;
  region: string;
  magic: number | null;
}

export interface ReconcileResult {
  accountsChecked: number;
  dealsAssociated: number;
  evidenceWritten: number;
  errors: string[];
}

/**
 * One reconciliation pass. Never throws: an evidence failure must not interrupt
 * execution, the scanner or any statistic.
 */
export async function reconcileBrokerEvidence(
  db: Db,
  options: { benchmarkAccountId?: string | null; now?: number } = {},
): Promise<ReconcileResult> {
  const now = options.now ?? Date.now();
  const result: ReconcileResult = {
    accountsChecked: 0,
    dealsAssociated: 0,
    evidenceWritten: 0,
    errors: [],
  };

  const since = new Date(now - RECONCILE_WINDOW_HOURS * 3_600_000);

  const { data: deliveryRows, error: deliveryError } = await db
    .from("execution_deliveries")
    .select(
      "id, user_id, signal_id, connected_account_id, client_id, magic, broker_symbol, submitted_entry, submitted_stop, submitted_target, account_mode",
    )
    .eq("destination_type", "metaapi_direct")
    .in("state", SUBMITTED_STATES as unknown as string[])
    .gte("submitted_at", since.toISOString());
  if (deliveryError) {
    result.errors.push(`deliveries unreadable: ${deliveryError.message}`);
    return result;
  }
  const deliveries = ((deliveryRows ?? []) as unknown as DeliveryRow[]).filter(
    (d) => d.client_id && d.connected_account_id,
  );
  if (!deliveries.length) return result;

  const byClientId = new Map<string, DeliveryRow>();
  const accountIds = new Set<string>();
  for (const d of deliveries) {
    byClientId.set(d.client_id as string, d);
    accountIds.add(d.connected_account_id);
  }

  const { data: accountRows } = await db
    .from("connected_trading_accounts")
    .select("id, user_id, metaapi_account_id, region, magic")
    .in("id", [...accountIds]);
  const accounts = (accountRows ?? []) as unknown as AccountRow[];

  for (const account of accounts) {
    if (!account.metaapi_account_id) continue;
    result.accountsChecked += 1;

    let deals;
    try {
      deals = await fetchDeals(
        account.metaapi_account_id,
        account.region,
        since,
        new Date(now),
      );
    } catch (err) {
      result.errors.push(
        `${account.id}: broker history unavailable — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const groups = groupOwnedDeals(deals, account.magic ?? null);
    for (const group of groups) {
      const delivery = byClientId.get(group.clientId);
      // No positively associated delivery ⇒ not our evidence to claim.
      if (!delivery || delivery.connected_account_id !== account.id) continue;
      result.dealsAssociated += 1;

      const written = await writeEvidence(db, {
        group,
        delivery,
        account,
        isBenchmark:
          !!options.benchmarkAccountId &&
          options.benchmarkAccountId === account.metaapi_account_id,
      });
      if (written === "error") result.errors.push(`${group.clientId}: evidence write failed`);
      else if (written === "written") result.evidenceWritten += 1;
    }
  }

  return result;
}

async function writeEvidence(
  db: Db,
  input: {
    group: DealGroup;
    delivery: DeliveryRow;
    account: AccountRow;
    isBenchmark: boolean;
  },
): Promise<"written" | "skipped" | "error"> {
  const { group, delivery, account } = input;
  const summary = summariseGroup(group);

  const { data: signalRow } = await db
    .from("scanned_signals")
    .select("direction")
    .eq("id", delivery.signal_id)
    .maybeSingle();
  const direction = (signalRow as { direction?: string } | null)?.direction ?? null;

  // Canonical Prompt-9 journal mathematics, unchanged: the ACTUAL fill anchors
  // both measures, and a missing input yields NULL with an explicit reason.
  const r = computeR({
    outcome: summary.state === "closed" ? "win" : "open",
    direction: direction === "long" || direction === "short" ? direction : null,
    plannedEntry: delivery.submitted_entry,
    plannedStop: delivery.submitted_stop,
    actualEntryPrice: summary.entryPrice,
    actualExitPrice: summary.exitPrice,
    actualInitialStop: delivery.submitted_stop,
  });

  const row = {
    user_id: delivery.user_id,
    evidence_class: evidenceClassFor(input.isBenchmark),
    account_id: account.id,
    metaapi_account_id: account.metaapi_account_id,
    signal_id: delivery.signal_id,
    delivery_id: delivery.id,
    client_id: group.clientId,
    magic: group.magic ?? delivery.magic,
    association_basis: group.basis,
    broker_order_id: group.brokerOrderId,
    broker_position_id: group.brokerPositionId,
    broker_symbol: group.symbol ?? delivery.broker_symbol ?? "unknown",
    direction: direction === "long" || direction === "short" ? direction : null,
    planned_entry: delivery.submitted_entry,
    planned_stop: delivery.submitted_stop,
    planned_target: delivery.submitted_target,
    actual_initial_stop: delivery.submitted_stop,
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
    deals: group.deals as unknown as Record<string, unknown>[],
    state: summary.state,
    resolved_at: summary.state === "closed" ? (summary.exitAt ?? new Date().toISOString()) : null,
  };

  const { data: existing } = await db
    .from("broker_trade_evidence")
    .select("id, state")
    .eq("client_id", group.clientId)
    .eq("metaapi_account_id", account.metaapi_account_id as string)
    .maybeSingle();
  const found = existing as { id: string; state: string } | null;

  if (!found) {
    const { error } = await db.from("broker_trade_evidence").insert(row as never);
    return error ? "error" : "written";
  }
  // Closed evidence is immutable — the database refuses the update too.
  if (found.state === "closed") return "skipped";

  const { error } = await db
    .from("broker_trade_evidence")
    .update(row as never)
    .eq("id", found.id);
  return error ? "error" : "written";
}
