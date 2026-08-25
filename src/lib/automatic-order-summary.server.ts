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

async function collectBounded<T>(fetchPage: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
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

  const [deliveries, evidence] = await Promise.all([
    collectBounded<AutomaticOrderDeliverySummaryRow>(async (from, to) => {
      const { data, error } = await db
        .from("execution_deliveries" as never)
        .select("state, dry_run, submitted_at, broker_retcode_string")
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
        .select("state, r_vs_plan, r_vs_actual_risk")
        .eq("user_id", userId)
        .eq("evidence_class", "customer")
        .order("first_observed_at", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AutomaticOrderEvidenceSummaryRow[];
    }),
  ]);

  return summarizeAutomaticOrders(deliveries, evidence);
}