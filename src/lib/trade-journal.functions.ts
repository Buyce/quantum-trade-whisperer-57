/**
 * Trade journal writes.
 *
 * R is NEVER accepted from the client. When the trader supplies the actual fills
 * they got, the server recomputes both canonical R values through the single
 * shared module `src/lib/journal/r-math.ts`:
 *
 *   r_vs_plan        = gross move / |planned_entry - planned_stop|
 *   r_vs_actual_risk = gross move / |actual_entry - actual_or_planned_stop|
 *
 * The gross move always anchors on the ACTUAL fill. The two bases are stored
 * separately and never averaged together. Plan context comes from the row's own
 * immutable creation-time snapshot, so R survives signal retention.
 *
 * The frozen legacy columns `realized_r_multiple` and `derived_r` are never
 * written again — the database trigger rejects any attempt.
 *
 * ZERO-HALLUCINATION: nothing is inferred or filled in. Missing prices mean a
 * missing R, reported as such.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computeR,
  computeNetR,
  R_MATH_VERSION,
  RMathInputError,
  type CostUnit,
  type RAvailability,
  type StopProvenance,
} from "@/lib/journal/r-math";

const schema = z.object({
  tradeId: z.string().uuid(),
  outcome: z.enum(["win", "loss", "breakeven", "open"]),
  /** Real fill price the user got. Optional, but paired with the exit. */
  actualEntryPrice: z.number().finite().positive().nullable().default(null),
  /** Real exit price the user got. Optional, but paired with the entry. */
  actualExitPrice: z.number().finite().positive().nullable().default(null),
  /** Stop actually placed at the broker, when the trader recorded it. */
  actualInitialStop: z.number().finite().positive().nullable().default(null),
  /** Monetary costs. Money, never a price distance. */
  commission: z.number().finite().nullable().default(null),
  swap: z.number().finite().nullable().default(null),
  costCurrency: z.string().max(16).nullable().default(null),
  costUnit: z
    .enum(["account_currency", "instrument_quote", "points", "unknown"])
    .nullable()
    .default(null),
});

export interface RecordOutcomeResult {
  ok: true;
  /** Canonical dual-basis result. Consumers must pick a basis explicitly. */
  rVsPlan: number | null;
  rVsActualRisk: number | null;
  rAvailability: RAvailability;
  stopProvenance: StopProvenance;
  netR: number | null;
  netRNote: string;
  alreadyResolved: boolean;
  message: string;
}

export const recordTradeOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }): Promise<RecordOutcomeResult> => {
    // RLS scopes this read to the caller's own trade.
    const { data: trade, error: readError } = await context.supabase
      .from("executed_trades")
      .select(
        "id, signal_id, outcome, planned_entry, planned_stop, planned_direction, actual_entry_price, actual_exit_price, actual_initial_stop, r_vs_plan, r_vs_actual_risk, r_availability, stop_provenance",
      )
      .eq("id", data.tradeId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!trade) throw new Error("Trade not found");

    const priced =
      data.outcome !== "open" && data.actualEntryPrice != null && data.actualExitPrice != null;

    // Direction fails closed. The snapshot is authoritative; for pre-snapshot
    // legacy rows we read the EXACT direction from the referenced signal if it
    // still exists. It is never inferred and never defaults to long.
    let direction = (trade.planned_direction as "long" | "short" | null) ?? null;
    if (direction == null && trade.signal_id) {
      const { data: signal } = await context.supabase
        .from("scanned_signals")
        .select("direction")
        .eq("id", trade.signal_id)
        .maybeSingle();
      const raw = signal?.direction == null ? null : String(signal.direction);
      direction = raw === "long" || raw === "short" ? raw : null;
    }

    let result;
    try {
      result = computeR({
        outcome: data.outcome,
        direction,
        plannedEntry: trade.planned_entry == null ? null : Number(trade.planned_entry),
        plannedStop: trade.planned_stop == null ? null : Number(trade.planned_stop),
        actualEntryPrice: data.outcome === "open" ? null : data.actualEntryPrice,
        actualExitPrice: data.outcome === "open" ? null : data.actualExitPrice,
        actualInitialStop: data.outcome === "open" ? null : data.actualInitialStop,
      });
    } catch (err) {
      if (err instanceof RMathInputError)
        throw new Error(`Invalid execution prices: ${err.message}`);
      throw err;
    }

    // Net R only exists with documented cost→R conversion provenance, which the
    // journal does not yet capture. Until then costs are stored as money and net
    // R stays explicitly unavailable rather than silently equal to gross R.
    const net = computeNetR(result.rVsActualRisk ?? result.rVsPlan, {
      commission: data.commission,
      swap: data.swap,
      costCurrency: data.costCurrency,
      costUnit: (data.costUnit as CostUnit | null) ?? null,
      documentedRValueInCostCurrency: null,
    });

    // Resolved-state protection is enforced in the database; this read-then-
    // branch turns a conflicting retry into a friendly message instead of a raw
    // constraint error. Identical retries fall through and no-op safely.
    const wasResolved = trade.outcome !== "open";

    const { error } = await context.supabase
      .from("executed_trades")
      .update({
        outcome: data.outcome,
        trade_state: data.outcome === "open" ? "open" : "resolved",
        actual_entry_price: data.outcome === "open" ? null : data.actualEntryPrice,
        actual_exit_price: data.outcome === "open" ? null : data.actualExitPrice,
        actual_initial_stop: data.outcome === "open" ? null : data.actualInitialStop,
        r_vs_plan: result.rVsPlan,
        r_vs_actual_risk: result.rVsActualRisk,
        r_availability: result.availability,
        stop_provenance: result.stopProvenance,
        r_math_version: R_MATH_VERSION,
        net_r: net.netR,
        commission: data.commission,
        swap: data.swap,
        cost_currency: data.costCurrency,
        cost_unit: data.costUnit,
        verification_level: priced ? "self_reported" : "unverified",
        // Provenance is stamped from the request path, never from input: this
        // handler is only reachable from the signed-in web terminal, so the
        // author is a person. Cleared with the prices it describes.
        price_source: priced ? "human" : null,
        price_source_client: null,
        price_recorded_at: priced ? new Date().toISOString() : null,
      })
      .eq("id", data.tradeId);

    if (error) {
      if (error.message.includes("trade_already_resolved")) {
        return {
          ok: true,
          rVsPlan: trade.r_vs_plan == null ? null : Number(trade.r_vs_plan),
          rVsActualRisk: trade.r_vs_actual_risk == null ? null : Number(trade.r_vs_actual_risk),
          rAvailability: (trade.r_availability as RAvailability) ?? "unavailable_no_prices",
          stopProvenance: (trade.stop_provenance as StopProvenance) ?? "unavailable",
          netR: null,
          netRNote: net.note,
          alreadyResolved: true,
          message: `This trade is already resolved as ${trade.outcome}. Nothing was changed.`,
        };
      }
      throw new Error(error.message);
    }

    return {
      ok: true,
      rVsPlan: result.rVsPlan,
      rVsActualRisk: result.rVsActualRisk,
      rAvailability: result.availability,
      stopProvenance: result.stopProvenance,
      netR: net.netR,
      netRNote: net.note,
      alreadyResolved: false,
      message:
        result.availability === "unavailable_no_direction"
          ? "Outcome recorded. R could not be computed: this trade's direction could not be established, and it is never assumed."
          : wasResolved
            ? "Identical retry accepted."
            : "Outcome recorded.",
    };
  });
