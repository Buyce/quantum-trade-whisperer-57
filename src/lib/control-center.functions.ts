/**
 * Live-account control center + reconciliation review.
 *
 * Read-only apart from acknowledging a flagged discrepancy. Everything is read
 * through the signed-in client, so RLS scopes it to the caller's own accounts.
 * Exposure counts come from broker-confirmed order states recorded by the
 * reconcile worker — never estimated.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface DiscrepancyView {
  id: string;
  accountId: string;
  kind: string;
  severity: "warning" | "critical";
  summary: string;
  status: "open" | "acknowledged";
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ControlCenterExtras {
  /** Per account: broker-confirmed open positions and resting orders from P-Trades. */
  exposure: Record<string, { openPositions: number; restingOrders: number }>;
  discrepancies: DiscrepancyView[];
}

export const getControlCenterExtras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ControlCenterExtras> => {
    const db = context.supabase;
    const [deliveries, discrepancies] = await Promise.all([
      db
        .from("execution_deliveries")
        .select("connected_account_id, broker_order_state")
        .eq("user_id", context.userId)
        .in("broker_order_state", ["open", "resting"])
        .limit(1000),
      db
        .from("reconciliation_discrepancies")
        .select("id, connected_account_id, kind, severity, summary, status, first_seen_at, last_seen_at")
        .eq("user_id", context.userId)
        .neq("status", "resolved")
        .order("last_seen_at", { ascending: false })
        .limit(200),
    ]);
    if (deliveries.error) throw new Error(deliveries.error.message);
    if (discrepancies.error) throw new Error(discrepancies.error.message);

    const exposure: ControlCenterExtras["exposure"] = {};
    for (const row of deliveries.data ?? []) {
      const id = row.connected_account_id;
      if (!id) continue;
      const e = (exposure[id] ??= { openPositions: 0, restingOrders: 0 });
      if (row.broker_order_state === "open") e.openPositions += 1;
      else e.restingOrders += 1;
    }
    return {
      exposure,
      discrepancies: (discrepancies.data ?? []).map((d) => ({
        id: d.id,
        accountId: d.connected_account_id,
        kind: d.kind,
        severity: d.severity as DiscrepancyView["severity"],
        summary: d.summary,
        status: d.status as DiscrepancyView["status"],
        firstSeenAt: d.first_seen_at,
        lastSeenAt: d.last_seen_at,
      })),
    };
  });

export const acknowledgeDiscrepancy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("reconciliation_discrepancies")
      .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
