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

import { fetchPositions } from "@/lib/metaapi/accounts.server";
import { fetchDeals, fetchHistoryOrders } from "@/lib/metaapi/history.server";
import { computeR, R_MATH_VERSION } from "@/lib/journal/r-math";
import { isSafeResearchRef, newsContextFor, pooledInclusionAllowed } from "@/lib/research/consent";
import {
  evidenceClassFor,
  groupOwnedDeals,
  resolveBrokerStop,
  summariseGroup,
  type BrokerStop,
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
  submitted_at: string | null;
  account_mode: string | null;
}

interface OpenEvidenceRow {
  id: string;
  delivery_id: number | null;
  first_observed_at: string;
  entry_at: string | null;
}

const OPEN_EVIDENCE_PAGE_SIZE = 1_000;
const OPEN_EVIDENCE_MAX_PAGES = 10;

interface AccountRow {
  id: string;
  user_id: string;
  metaapi_account_id: string | null;
  region: string;
  magic: number | null;
  broker_account_type: string | null;
  research_consent: boolean;
  research_consent_version: number | null;
  research_consent_at: string | null;
  research_account_ref: string | null;
}

export interface ReconcileResult {
  accountsChecked: number;
  dealsAssociated: number;
  evidenceWritten: number;
  errors: string[];
}

async function recordReconciliationHealth(
  db: Db,
  accountId: string,
  outcome: { ok: true; at: string } | { ok: false; at: string; error: string },
): Promise<void> {
  const patch = outcome.ok
    ? {
        reconciliation_last_success_at: outcome.at,
        reconciliation_last_error: null,
      }
    : {
        reconciliation_last_error_at: outcome.at,
        reconciliation_last_error: outcome.error.slice(0, 1_000),
      };
  await db.from("connected_trading_accounts").update(patch).eq("id", accountId);
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

  // The normal scan is intentionally recent, but an open broker position can
  // outlive that window. Recover its delivery and extend the history range to
  // the original entry/submission so a later exit is not stranded forever as
  // "open" evidence.
  const openEvidence: OpenEvidenceRow[] = [];
  let openEvidenceComplete = false;
  for (let page = 0; page < OPEN_EVIDENCE_MAX_PAGES; page += 1) {
    const start = page * OPEN_EVIDENCE_PAGE_SIZE;
    const { data, error } = await db
      .from("broker_trade_evidence")
      .select("id, delivery_id, first_observed_at, entry_at")
      .eq("state", "open")
      .not("delivery_id", "is", null)
      .order("first_observed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + OPEN_EVIDENCE_PAGE_SIZE - 1);
    if (error) {
      result.errors.push(`open evidence unreadable: ${error.message}`);
      break;
    }
    const rows = (data ?? []) as unknown as OpenEvidenceRow[];
    openEvidence.push(...rows);
    if (rows.length < OPEN_EVIDENCE_PAGE_SIZE) {
      openEvidenceComplete = true;
      break;
    }
  }
  if (!openEvidenceComplete && openEvidence.length) {
    result.errors.push(
      `open evidence exceeded ${OPEN_EVIDENCE_MAX_PAGES * OPEN_EVIDENCE_PAGE_SIZE} rows; older positions were not reconciled from a partial population`,
    );
    openEvidence.length = 0;
  }

  const { data: deliveryRows, error: deliveryError } = await db
    .from("execution_deliveries")
    .select(
      "id, user_id, signal_id, connected_account_id, client_id, magic, broker_symbol, submitted_entry, submitted_stop, submitted_target, submitted_at, account_mode",
    )
    .eq("destination_type", "metaapi_direct")
    .in("state", SUBMITTED_STATES as unknown as string[])
    .gte("submitted_at", since.toISOString());
  if (deliveryError) {
    result.errors.push(`deliveries unreadable: ${deliveryError.message}`);
    return result;
  }
  const deliveryById = new Map<number, DeliveryRow>();
  for (const delivery of (deliveryRows ?? []) as unknown as DeliveryRow[]) {
    if (delivery.client_id && delivery.connected_account_id)
      deliveryById.set(delivery.id, delivery);
  }

  const unresolvedDeliveryIds = [
    ...new Set(
      openEvidence
        .map((row) => row.delivery_id)
        .filter((id): id is number => typeof id === "number" && !deliveryById.has(id)),
    ),
  ];
  for (let start = 0; start < unresolvedDeliveryIds.length; start += 200) {
    const ids = unresolvedDeliveryIds.slice(start, start + 200);
    const { data, error } = await db
      .from("execution_deliveries")
      .select(
        "id, user_id, signal_id, connected_account_id, client_id, magic, broker_symbol, submitted_entry, submitted_stop, submitted_target, submitted_at, account_mode",
      )
      .eq("destination_type", "metaapi_direct")
      .in("state", SUBMITTED_STATES as unknown as string[])
      .in("id", ids);
    if (error) {
      result.errors.push(`older open deliveries unreadable: ${error.message}`);
      continue;
    }
    for (const delivery of (data ?? []) as unknown as DeliveryRow[]) {
      if (delivery.client_id && delivery.connected_account_id)
        deliveryById.set(delivery.id, delivery);
    }
  }

  const deliveries = [...deliveryById.values()];
  if (!deliveries.length) return result;

  const openEvidenceByDelivery = new Map(
    openEvidence
      .filter((row): row is OpenEvidenceRow & { delivery_id: number } => row.delivery_id !== null)
      .map((row) => [row.delivery_id, row]),
  );

  const byClientId = new Map<string, DeliveryRow>();
  const accountIds = new Set<string>();
  for (const d of deliveries) {
    byClientId.set(d.client_id as string, d);
    accountIds.add(d.connected_account_id);
  }

  const { data: accountRows } = await db
    .from("connected_trading_accounts")
    .select(
      "id, user_id, metaapi_account_id, region, magic, broker_account_type, research_consent, research_consent_version, research_consent_at, research_account_ref",
    )
    .in("id", [...accountIds]);
  const accounts = (accountRows ?? []) as unknown as AccountRow[];

  for (const account of accounts) {
    if (!account.metaapi_account_id) continue;
    result.accountsChecked += 1;

    let deals;
    const accountSince = deliveries
      .filter((delivery) => delivery.connected_account_id === account.id)
      .reduce((earliest, delivery) => {
        const evidence = openEvidenceByDelivery.get(delivery.id);
        if (!evidence) return earliest;
        const candidates = [delivery.submitted_at, evidence.entry_at, evidence.first_observed_at]
          .map((value) => (value ? Date.parse(value) : Number.NaN))
          .filter(Number.isFinite);
        return candidates.length ? Math.min(earliest, ...candidates) : earliest;
      }, since.getTime());
    const historyStart = new Date(accountSince);
    try {
      deals = await fetchDeals(
        account.metaapi_account_id,
        account.region,
        historyStart,
        new Date(now),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(
        `${account.id}: broker history unavailable — ${message}`,
      );
      await recordReconciliationHealth(db, account.id, {
        ok: false,
        at: new Date(now).toISOString(),
        error: `broker history unavailable — ${message}`,
      });
      continue;
    }

    // Broker-held stops (F): read once per account, never derived from what we
    // submitted. Unavailable history simply leaves the stop unknown.
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
        historyStart,
        new Date(now),
      );
    } catch {
      historyOrders = [];
    }

    const groups = groupOwnedDeals(deals, account.magic ?? null);
    for (const group of groups) {
      const delivery = byClientId.get(group.clientId);
      // No positively associated delivery ⇒ not our evidence to claim.
      if (!delivery || delivery.connected_account_id !== account.id) continue;
      result.dealsAssociated += 1;

      try {
        const written = await writeEvidence(db, {
          group,
          delivery,
          account,
          brokerStop: resolveBrokerStop(group, positions, historyOrders),
          isBenchmark:
            !!options.benchmarkAccountId && options.benchmarkAccountId === account.metaapi_account_id,
        });
        if (written === "error") result.errors.push(`${group.clientId}: evidence write failed`);
        else if (written === "written") result.evidenceWritten += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`${group.clientId}: evidence invalid — ${message}`);
      }
    }
    const accountErrors = result.errors.filter((error) => error.startsWith(`${account.id}:`));
    if (accountErrors.length === 0) {
      await recordReconciliationHealth(db, account.id, {
        ok: true,
        at: new Date(now).toISOString(),
      });
    } else {
      await recordReconciliationHealth(db, account.id, {
        ok: false,
        at: new Date(now).toISOString(),
        error: accountErrors.join("; "),
      });
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
    brokerStop: BrokerStop;
    isBenchmark: boolean;
  },
): Promise<"written" | "skipped" | "error"> {
  const { group, delivery, account } = input;
  const summary = summariseGroup(group);

  const { data: signalRow } = await db
    .from("scanned_signals")
    .select("direction, instrument, grade, detected_at")
    .eq("id", delivery.signal_id)
    .maybeSingle();
  const signal = signalRow as {
    direction?: string;
    instrument?: string;
    grade?: string;
    detected_at?: string;
  } | null;
  const direction = signal?.direction ?? null;
  const { data: contextRow } = await db
    .from("market_context")
    .select("trading_session, time_of_day, day_of_week")
    .eq("signal_id", delivery.signal_id)
    .maybeSingle();
  const context = contextRow as {
    trading_session?: string;
    time_of_day?: number;
    day_of_week?: number;
  } | null;

  const consent = pooledInclusionAllowed({
    researchConsent: account.research_consent,
    researchConsentVersion: account.research_consent_version,
    researchConsentAt: account.research_consent_at,
  });
  const researchRefAllowed =
    !input.isBenchmark &&
    consent.included &&
    isSafeResearchRef(account.research_account_ref, [
      account.id,
      account.user_id,
      account.metaapi_account_id,
    ]);

  // Canonical Prompt-9 journal mathematics, unchanged: the ACTUAL fill anchors
  // both measures, and a missing input yields NULL with an explicit reason.
  const r = computeR({
    outcome: summary.state === "closed" ? "win" : "open",
    direction: direction === "long" || direction === "short" ? direction : null,
    plannedEntry: delivery.submitted_entry,
    plannedStop: delivery.submitted_stop,
    actualEntryPrice: summary.entryPrice,
    actualExitPrice: summary.exitPrice,
    // Broker-held stop only. When the broker reports none, the actual-risk R is
    // declared unavailable rather than falling back to the requested stop.
    actualInitialStop: input.brokerStop.stop,
  });

  const row = {
    user_id: delivery.user_id,
    evidence_class: evidenceClassFor(input.isBenchmark),
    evidence_phase: "development",
    news_context: newsContextFor(),
    // Snapshot consent at observation time. Withdrawing on the account stops
    // future rows from receiving either the flag or pseudonymous reference.
    research_consent: researchRefAllowed,
    research_account_ref: researchRefAllowed ? account.research_account_ref : null,
    account_id: account.id,
    metaapi_account_id: account.metaapi_account_id,
    signal_id: delivery.signal_id,
    signal_instrument: signal?.instrument ?? null,
    signal_grade: signal?.grade ?? null,
    signal_detected_at: signal?.detected_at ?? null,
    signal_trading_session: context?.trading_session ?? null,
    signal_time_of_day: typeof context?.time_of_day === "number" ? context.time_of_day : null,
    signal_day_of_week: typeof context?.day_of_week === "number" ? context.day_of_week : null,
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
    actual_initial_stop: input.brokerStop.stop,
    stop_source: input.brokerStop.source,
    broker_account_type: account.broker_account_type,
    last_reconciled_at: new Date().toISOString(),
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

  // Consent and phase are observation-time facts. An opt-out stops future
  // evidence; it must not rewrite the consent snapshot on a row already
  // observed, even while that broker position remains open.
  const updateRow: Record<string, unknown> = { ...row };
  delete updateRow["research_consent"];
  delete updateRow["research_account_ref"];
  delete updateRow["evidence_phase"];
  delete updateRow["news_context"];
  if (!signal) {
    delete updateRow["signal_instrument"];
    delete updateRow["signal_grade"];
    delete updateRow["signal_detected_at"];
  }
  if (!context) {
    delete updateRow["signal_trading_session"];
    delete updateRow["signal_time_of_day"];
    delete updateRow["signal_day_of_week"];
  }

  const { error } = await db
    .from("broker_trade_evidence")
    .update(updateRow as never)
    .eq("id", found.id);
  return error ? "error" : "written";
}
