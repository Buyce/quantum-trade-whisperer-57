/**
 * Owner-authenticated per-order live confirmation.
 *
 * Every function here is scoped to the signed-in owner's own deliveries. A
 * confirmation only records CONSENT: it does not skip a single downstream gate.
 * The dispatcher still refreshes the destination account, re-reads a live broker
 * quote and re-applies risk, news, market-hours and duplicate rules before any
 * order leaves, and it refuses again if the confirmation window has passed.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { confirmationMsRemaining, confirmationState } from "@/lib/delivery/confirmation";

const idInput = z.object({ deliveryId: z.number().int().positive() });
const declineInput = idInput.extend({ reason: z.string().trim().max(300).optional() });

interface QueueRow {
  id: number;
  signal_id: string | null;
  state: string;
  account_mode: string | null;
  connected_account_id: string | null;
  requires_confirmation: boolean | null;
  confirmed_at: string | null;
  confirmation_expires_at: string | null;
  confirmation_declined_at: string | null;
  confirmation_declined_reason: string | null;
  risk_amount: number | string | null;
  risk_currency: string | null;
  risk_percent_of_equity: number | string | null;
  enqueued_at: string | null;
}

const num = (value: number | string | null): number | null => {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The caller's live orders that are waiting on a decision, newest first.
 *
 * Risk figures are shown only when they were actually recorded for that order;
 * an order queued before the figure existed reads as unknown, never as zero.
 */
export const getLiveConfirmationQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("execution_deliveries")
      .select(
        "id, signal_id, state, account_mode, connected_account_id, requires_confirmation, confirmed_at, confirmation_expires_at, confirmation_declined_at, confirmation_declined_reason, risk_amount, risk_currency, risk_percent_of_equity, enqueued_at",
      )
      .eq("state", "awaiting_confirmation")
      .order("enqueued_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as QueueRow[];

    const signalIds = [...new Set(rows.map((r) => r.signal_id).filter((v): v is string => !!v))];
    const signals = new Map<string, Record<string, unknown>>();
    if (signalIds.length > 0) {
      const { data: signalRows } = await context.supabase
        .from("scanned_signals")
        .select("id, instrument, grade, direction, entry_price, stop_loss, detected_at")
        .in("id", signalIds);
      for (const row of (signalRows ?? []) as Record<string, unknown>[]) {
        signals.set(String(row["id"]), row);
      }
    }

    const nowMs = Date.now();
    return rows.map((row) => {
      const signal = row.signal_id ? signals.get(row.signal_id) : undefined;
      return {
        deliveryId: row.id,
        signalId: row.signal_id,
        accountMode: row.account_mode,
        instrument: (signal?.["instrument"] as string | null) ?? null,
        grade: (signal?.["grade"] as string | null) ?? null,
        direction: (signal?.["direction"] as string | null) ?? null,
        entryPrice: num((signal?.["entry_price"] as number | null) ?? null),
        stopLoss: num((signal?.["stop_loss"] as number | null) ?? null),
        detectedAt: (signal?.["detected_at"] as string | null) ?? null,
        enqueuedAt: row.enqueued_at,
        expiresAt: row.confirmation_expires_at,
        msRemaining: confirmationMsRemaining(row.confirmation_expires_at, nowMs),
        riskAmount: num(row.risk_amount),
        riskCurrency: row.risk_currency,
        riskPercentOfEquity: num(row.risk_percent_of_equity),
        status: confirmationState(
          {
            state: row.state,
            requiresConfirmation: row.requires_confirmation,
            confirmedAt: row.confirmed_at,
            confirmationExpiresAt: row.confirmation_expires_at,
            declinedAt: row.confirmation_declined_at,
          },
          nowMs,
        ),
      };
    });
  });

async function loadOwnRequest(userId: string, deliveryId: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("execution_deliveries")
    .select(
      "id, user_id, state, requires_confirmation, confirmed_at, confirmation_expires_at, confirmation_declined_at",
    )
    .eq("id", deliveryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { db: supabaseAdmin, row: null, error: error.message };
  return { db: supabaseAdmin, row: data as QueueRow & { user_id: string } | null, error: null };
}

/**
 * Record the owner's consent for one queued live order.
 *
 * The row moves to `pending`, which is only an instruction to ATTEMPT the order.
 * It is never a fill, and it is never a claim that the broker accepted anything.
 */
export const confirmLiveOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const { db, row, error } = await loadOwnRequest(context.userId, data.deliveryId);
    if (error) return { ok: false as const, error };
    if (!row) return { ok: false as const, error: "that order request no longer exists" };
    if (row.state !== "awaiting_confirmation") {
      return { ok: false as const, error: `this request is already ${row.state}` };
    }
    if (row.confirmation_declined_at) {
      return { ok: false as const, error: "you already declined this order" };
    }
    const expiry = row.confirmation_expires_at;
    if (expiry && new Date(expiry).getTime() <= Date.now()) {
      return {
        ok: false as const,
        error: "the confirmation window for this setup has passed, so it will not be placed",
      };
    }

    const { error: writeError } = await db
      .from("execution_deliveries")
      .update({
        state: "pending",
        confirmed_at: new Date().toISOString(),
        confirmed_by: context.userId,
      } as never)
      .eq("id", row.id)
      .eq("user_id", context.userId)
      .eq("state", "awaiting_confirmation");
    if (writeError) return { ok: false as const, error: writeError.message };
    return { ok: true as const };
  });

/** Decline one queued live order. It is settled and never submitted. */
export const declineLiveOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => declineInput.parse(input))
  .handler(async ({ data, context }) => {
    const { db, row, error } = await loadOwnRequest(context.userId, data.deliveryId);
    if (error) return { ok: false as const, error };
    if (!row) return { ok: false as const, error: "that order request no longer exists" };
    if (row.state !== "awaiting_confirmation") {
      return { ok: false as const, error: `this request is already ${row.state}` };
    }
    const now = new Date().toISOString();
    const { error: writeError } = await db
      .from("execution_deliveries")
      .update({
        state: "expired",
        reason: "declined_by_owner",
        settled_at: now,
        confirmation_declined_at: now,
        confirmation_declined_reason: data.reason?.trim() || null,
      } as never)
      .eq("id", row.id)
      .eq("user_id", context.userId)
      .eq("state", "awaiting_confirmation");
    if (writeError) return { ok: false as const, error: writeError.message };
    return { ok: true as const };
  });
