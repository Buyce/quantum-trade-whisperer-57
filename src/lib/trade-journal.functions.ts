/**
 * Trade journal writes.
 *
 * The R multiple is NEVER accepted from the client. When the user supplies the
 * actual entry and exit price they got, the server recomputes R from the
 * originating signal's own risk distance (|entry - stop|) so the number is
 * reproducible and auditable. Without prices, R stays null — an honest unknown
 * rather than a preset guess.
 *
 * ZERO-HALLUCINATION: nothing is inferred or filled in. Missing prices mean a
 * missing R.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  tradeId: z.string().uuid(),
  outcome: z.enum(["win", "loss", "breakeven", "open"]),
  /** Real fill price the user got. Optional. */
  actualEntryPrice: z.number().finite().positive().nullable().default(null),
  /** Real exit price the user got. Optional. */
  actualExitPrice: z.number().finite().positive().nullable().default(null),
});

export interface RecordOutcomeResult {
  ok: true;
  derivedR: number | null;
}

export const recordTradeOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }): Promise<RecordOutcomeResult> => {
    // RLS scopes this read to the caller's own trade.
    const { data: trade, error: readError } = await context.supabase
      .from("executed_trades")
      .select("id, signal_id, scanned_signals(entry_price, stop_loss, direction)")
      .eq("id", data.tradeId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!trade) throw new Error("Trade not found");

    const rawSignal = (trade as { scanned_signals: unknown }).scanned_signals;
    const signal = (Array.isArray(rawSignal) ? rawSignal[0] : rawSignal) as
      | { entry_price: number; stop_loss: number; direction: "long" | "short" }
      | null
      | undefined;

    let derivedR: number | null = null;
    if (
      data.outcome !== "open" &&
      data.actualEntryPrice != null &&
      data.actualExitPrice != null &&
      signal
    ) {
      const risk = Math.abs(Number(signal.entry_price) - Number(signal.stop_loss));
      if (risk > 0) {
        const move =
          signal.direction === "long"
            ? data.actualExitPrice - data.actualEntryPrice
            : data.actualEntryPrice - data.actualExitPrice;
        derivedR = Math.round((move / risk) * 10000) / 10000;
      }
    }

    const keepPrices =
      data.outcome !== "open" && data.actualEntryPrice != null && data.actualExitPrice != null;

    const { error } = await context.supabase
      .from("executed_trades")
      .update({
        outcome: data.outcome,
        actual_entry_price: data.outcome === "open" ? null : data.actualEntryPrice,
        actual_exit_price: data.outcome === "open" ? null : data.actualExitPrice,
        derived_r: derivedR,
        // Kept in sync so every downstream aggregate reads one number, and that
        // number is now price-derived rather than a button press.
        realized_r_multiple: derivedR,
        // Provenance is stamped from the request path, never from input: this
        // handler is only reachable from the signed-in web terminal, so the
        // author is a person. Cleared with the prices it describes.
        price_source: keepPrices ? "human" : null,
        price_source_client: null,
        price_recorded_at: keepPrices ? new Date().toISOString() : null,
      })
      .eq("id", data.tradeId);
    if (error) throw new Error(error.message);


    return { ok: true, derivedR };
  });
