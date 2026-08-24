/**
 * Prompt 14 Stage 3/4 final closure (3) — the FINAL quantity, derived from the
 * broker snapshot taken immediately before submission.
 *
 * Sizing used to happen during revalidation, minutes before the order left. If
 * equity moved in between — a closed position, a withdrawal, a losing trade —
 * the submitted volume described an account that no longer existed. The order of
 * operations is now:
 *
 *   claim → revalidate → refresh broker facts → refreshed equity/currency
 *         → fresh account specification → authoritative quantity → margin
 *         → submit once
 *
 * This module is the single place that step is implemented, so the terminal, the
 * dispatcher and the tests cannot drift. It never retries and it never resizes
 * after an order has been emitted: it is called strictly before submission.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { validateQuantity, type OrderQuantity } from "@/lib/delivery/execution";
import { isAccountSizingRefusal, resolveSizingForAccount } from "@/lib/sizing/service.server";

type Db = Pick<SupabaseClient, "from" | "rpc">;

/** The broker snapshot the final quantity must be derived from. */
export interface BrokerSnapshot {
  equity: number | null;
  currency: string | null;
  observedAt: string | null;
}

export interface ResizeRequest {
  userId: string;
  accountId: string;
  instrument: string;
  entryPrice: number;
  stopLoss: number;
  signalId: string;
  /** Operator-owned benchmark risk percentage; absent ⇒ the account owner's. */
  riskPercent?: number | null;
}

export type ResizeResult =
  | { ok: true; quantity: OrderQuantity; equityUsed: number }
  | { ok: false; reason: string; detail: string };

/**
 * Re-derive the authoritative connected-account quantity from `snapshot`.
 *
 * Fails closed on every missing broker input; the caller must abandon the order
 * rather than submit an earlier, differently-sized quantity.
 */
export async function resizeFromBrokerSnapshot(
  db: Db,
  request: ResizeRequest,
  snapshot: BrokerSnapshot,
  now = Date.now(),
): Promise<ResizeResult> {
  const sizing = await resolveSizingForAccount(
    db,
    request.userId,
    {
      id: request.accountId,
      equity: snapshot.equity,
      currency: snapshot.currency,
      equityAsOf: snapshot.observedAt,
    },
    {
      instrument: request.instrument,
      entryPrice: request.entryPrice,
      stopLoss: request.stopLoss,
      signalId: request.signalId,
    },
    now,
    { riskPercent: request.riskPercent ?? null },
  );

  if (isAccountSizingRefusal(sizing)) {
    return { ok: false, reason: sizing.accountReason, detail: sizing.detail };
  }
  if (!sizing.available) {
    return { ok: false, reason: "risk_guardrail", detail: sizing.explanation };
  }
  if (sizing.belowMinimumLot || sizing.exceedsMargin || sizing.exceedsStopCeiling) {
    return {
      ok: false,
      reason: "risk_guardrail",
      detail: sizing.belowMinimumLot
        ? "below broker minimum lot"
        : sizing.exceedsMargin
          ? "margin estimate exceeds equity"
          : "stop exceeds the stop-loss ceiling",
    };
  }

  const check = validateQuantity(sizing.lots, {
    minLot: null,
    maxLot: null,
    lotStep: null,
    volumeCap: sizing.brokerVolumeCap,
  });
  if (!check.ok) return { ok: false, reason: "quantity_unavailable", detail: check.detail };

  return {
    ok: true,
    equityUsed: sizing.profile.accountEquity,
    quantity: {
      lots: sizing.lots,
      sizingModel: sizing.provenance.authoritativeModel,
      specSource: sizing.provenance.specSource,
      specAsOf: sizing.provenance.specAsOf,
    },
  };
}
