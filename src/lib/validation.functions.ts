/**
 * Runtime Validation (dry run) for every signed-in user, scoped to their own
 * connected accounts. Never submits, arms or edits.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ValidationReport } from "@/lib/validation/report";

export interface ValidationAccountOption {
  id: string;
  label: string;
  accountType: string | null;
  connected: boolean;
}

export const listValidationAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ValidationAccountOption[]> => {
    const { data, error } = await context.supabase
      .from("connected_trading_accounts")
      .select("id, label, broker_account_type, disconnected_at")
      .eq("user_id", context.userId)
      .order("label");
    if (error) throw new Error(error.message);
    return (data ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      accountType: (a as { broker_account_type?: string | null }).broker_account_type ?? null,
      connected: !a.disconnected_at,
    }));
  });

export const runRuntimeValidationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        accountIds: z.array(z.string().uuid()).min(1).max(10),
        symbol: z.string().trim().min(3).max(20),
        direction: z.enum(["long", "short"]),
        stopDistance: z.number().positive().max(100_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ValidationReport[]> => {
    // Users may only validate their own accounts.
    const { data: owned, error: ownErr } = await context.supabase
      .from("connected_trading_accounts")
      .select("id")
      .eq("user_id", context.userId)
      .in("id", data.accountIds);
    if (ownErr) throw new Error(ownErr.message);
    const ownedIds = new Set((owned ?? []).map((a) => a.id));
    if (ownedIds.size !== data.accountIds.length) throw new Error("Forbidden");
    const { runRuntimeValidation } = await import("@/lib/validation/runtime.server");
    const out: ValidationReport[] = [];
    for (const accountId of data.accountIds) {
      out.push(
        await runRuntimeValidation(context.supabase, {
          accountId,
          symbol: data.symbol,
          direction: data.direction,
          stopDistance: data.stopDistance,
        }),
      );
    }
    return out;
  });
