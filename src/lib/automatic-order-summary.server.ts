/** Server-only loader for automatic-order accounting. */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  summarizeAutomaticOrders,
  type AutomaticOrderDeliverySummaryRow,
  type AutomaticOrderEvidenceSummaryRow,
  type AutomaticOrderSummary,
} from "@/lib/automatic-order-summary";
import { collectCompletePages } from "@/lib/pagination";

type Db = SupabaseClient<never, never, never>;

const PAGE_SIZE = 1_000;
const MAX_PAGES = 10;

async function collectBounded<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  return await collectCompletePages({
    fetchPage,
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES,
    overflowMessage: `Automatic-order ledger exceeded ${PAGE_SIZE * MAX_PAGES} rows; refusing incomplete accounting`,
  });
}

export async function loadAutomaticOrderSummary(
  requestingClient: unknown,
  userId: string,
): Promise<AutomaticOrderSummary> {
  const db = requestingClient as Db;

  const [deliveries, evidence, accountHealth] = await Promise.all([
    collectBounded<AutomaticOrderDeliverySummaryRow>(async (from, to) => {
      const { data, error } = await db
        .from("execution_deliveries" as never)
        .select("id, state, dry_run, submitted_at, broker_retcode_string, broker_order_state")
        .eq("user_id", userId)
        .eq("destination_type", "metaapi_direct")
        .order("enqueued_at", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AutomaticOrderDeliverySummaryRow[];
    }),
    collectBounded<AutomaticOrderEvidenceSummaryRow>(async (from, to) => {
      const { data, error } = await db
        .from("broker_trade_evidence" as never)
        .select("delivery_id, state, r_vs_plan, r_vs_actual_risk")
        .eq("user_id", userId)
        .eq("evidence_class", "customer")
        .order("first_observed_at", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AutomaticOrderEvidenceSummaryRow[];
    }),
    db
      .from("connected_trading_accounts" as never)
      .select(
        "reconciliation_last_success_at, reconciliation_last_error_at, reconciliation_last_error",
      )
      .eq("user_id", userId)
      .is("disconnected_at", null),
  ]);

  const summary = summarizeAutomaticOrders(deliveries, evidence);
  const healthRows = (
    (accountHealth.data ?? []) as unknown as Array<{
      reconciliation_last_success_at: string | null;
      reconciliation_last_error_at: string | null;
      reconciliation_last_error: string | null;
    }>
  ).sort((a, b) =>
    String(b.reconciliation_last_error_at ?? b.reconciliation_last_success_at ?? "").localeCompare(
      String(a.reconciliation_last_error_at ?? a.reconciliation_last_success_at ?? ""),
    ),
  );
  if (accountHealth.error) throw new Error(accountHealth.error.message);
  summary.reconciliationLastSuccessAt =
    healthRows
      .map((row) => row.reconciliation_last_success_at)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
  const latestFailure = healthRows.find((row) => row.reconciliation_last_error_at !== null);
  summary.reconciliationLastErrorAt = latestFailure?.reconciliation_last_error_at ?? null;
  summary.reconciliationLastError = latestFailure?.reconciliation_last_error ?? null;
  return summary;
}
