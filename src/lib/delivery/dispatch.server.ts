/**
 * The delivery worker body.
 *
 * Claim one `pending` row → revalidate → sign → POST → settle. Every step is
 * recorded on the delivery row, so the state machine is the audit trail:
 *
 *   pending → claimed → sent → acknowledged | unknown
 *                     → rejected (revalidation refused; no POST happened)
 *                     → failed   (transport error; no acknowledgement)
 *
 * `sent` and `unknown` are never re-claimed. A POST that we cannot prove failed
 * may already have created a broker order, so an automatic retry is exactly how
 * a bridge double-fires. Those rows are resolved by a human or a dry-run replay.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { submitDirectOrder } from "@/lib/execution/direct.server";
import { INSTRUMENT_NOT_APPROVED } from "@/lib/instruments/lifecycle";
import { assertCapability } from "@/lib/instruments/lifecycle.server";
import { PAYLOAD_VERSION, requestFingerprint, signBody } from "./hmac";
import { revalidateDelivery, type DeliveryRow } from "./revalidate.server";
import {
  EXECUTION_POLICY_NOTE,
  REJECT_COPY,
  type BridgeOrder,
  type DeliveryState,
} from "./execution";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export const DISPATCH_TIMEOUT_MS = 6_000;
export const LEASE_SECONDS = 60;

export interface DispatchResult {
  deliveryId: number;
  state: DeliveryState;
  reason: string | null;
  dryRun: boolean;
}

function fmt(v: number) {
  return v >= 100 ? v.toFixed(2) : v.toFixed(5);
}

/** JSON payload v2. The body `secret` is retained for the existing receiver. */
export function jsonBody(order: BridgeOrder, secret: string, dryRun: boolean) {
  return {
    payload_version: PAYLOAD_VERSION,
    secret,
    event: "execution",
    dry_run: dryRun,
    execution_policy: order.policy,
    execution_policy_note: EXECUTION_POLICY_NOTE,
    signal_id: order.signalId,
    instrument: order.instrument,
    action: order.action,
    grade: order.grade,
    entry: order.entry,
    max_acceptable_entry: order.maxAcceptableEntry,
    stop_loss: order.stopLoss,
    take_profit: order.takeProfit,
    // The authoritative position quantity, with its provenance. There is no
    // default: the delivery is rejected before this point when it is unknown.
    quantity: order.quantity.lots,
    quantity_unit: "lots",
    quantity_sizing_model: order.quantity.sizingModel,
    quantity_spec_source: order.quantity.specSource,
    quantity_spec_as_of: order.quantity.specAsOf,
    rr: order.rr,
    confidence: order.confidence,
    expires_in_minutes: order.expiresInMinutes,
  };
}

/**
 * PineConnector single-line format. The bridge itself is UNAUTHENTICATED beyond
 * the licence id in the body — it has no signature scheme — so the signature
 * headers are still sent but cannot be relied on by that receiver.
 *
 * Its volume/risk field syntax is NOT verified against the receiver contract, so
 * no quantity is guessed here and this format is dry-run-only for automatic
 * execution (enforced in revalidation).
 */
export function pineBody(order: BridgeOrder, licence: string): string {
  return [
    licence,
    order.action === "buy_limit" ? "buylimit" : "selllimit",
    order.instrument,
    `price=${fmt(order.entry)}`,
    `sl=${fmt(order.stopLoss)}`,
    `tp=${fmt(order.takeProfit)}`,
    `expiration=${order.expiresInMinutes}`,
    `comment=P-Trades ${order.grade}`,
  ].join(",");
}

/** Extracts a broker order id when the bridge returns one. Absence ⇒ `unknown`. */
export function readOrderId(text: string): string | null {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["order_id", "orderId", "ticket", "order"]) {
      const v = json[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return null;
  } catch {
    // A 200 carrying an HTML error page is not an acknowledgement.
    return null;
  }
}

async function settle(db: Db, id: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("execution_deliveries").update(patch).eq("id", id);
  if (error) console.error("[dispatch] settle failed", { id, error: error.message });
}

/**
 * Processes at most one delivery. Returns null when the queue is empty. Never
 * throws: an execution failure must not interrupt the scanner or statistics.
 */
export async function processNextDelivery(
  db: Db,
  now = Date.now(),
): Promise<DispatchResult | null> {
  const { data, error } = await db.rpc("claim_execution_delivery", {
    lease_seconds: LEASE_SECONDS,
  });
  if (error) {
    console.error("[dispatch] claim failed", error.message);
    return null;
  }
  const rows = (data ?? []) as DeliveryRow[];
  const delivery = rows[0];
  if (!delivery) return null;

  let approved;
  try {
    approved = await revalidateDelivery(db, delivery, now);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await settle(db, delivery.id, {
      state: "failed",
      reason: `revalidation error: ${detail}`,
      settled_at: new Date().toISOString(),
    });
    return { deliveryId: delivery.id, state: "failed", reason: detail, dryRun: delivery.dry_run };
  }

  if (!approved.ok) {
    const reason = approved.detail ? `${approved.reason}: ${approved.detail}` : approved.reason;
    await settle(db, delivery.id, {
      state: "rejected",
      reason,
      settled_at: new Date().toISOString(),
    });
    return { deliveryId: delivery.id, state: "rejected", reason, dryRun: delivery.dry_run };
  }

  /**
   * The LAST lifecycle read, taken here rather than only in revalidation
   * (Phase A2A, R3-FIX).
   *
   * Revalidation is followed by several awaited round trips — settlement writes,
   * a broker equity snapshot, a resize — before anything irreversible happens. An
   * emergency suspension decided inside that window must still be honoured, so
   * the stage is re-read immediately before the submission boundary and the
   * delivery is rejected without a POST if execution is no longer authorised.
   * A degraded read refuses everything outside the frozen Wave 0 universe.
   */
  // The ORDER's instrument is the authority here: it is the symbol that would
  // actually be submitted, so the gate cannot be bypassed by a plan/order
  // mismatch.
  const submittedInstrument = approved.order.instrument;
  const finalGate = await assertCapability(
    db as unknown as SupabaseClient,
    submittedInstrument,
    "execute",
  );
  if (!finalGate.allowed) {
    const reason = `${INSTRUMENT_NOT_APPROVED}: ${
      finalGate.reason ?? `${submittedInstrument} is not approved for execution`
    }`;
    await settle(db, delivery.id, {
      state: "rejected",
      reason,
      settled_at: new Date().toISOString(),
    });
    return { deliveryId: delivery.id, state: "rejected", reason, dryRun: approved.dryRun };
  }

  // ---- Direct broker destination (Prompt 14 Stage 3) -----------------------
  // Constructed and submitted by us, so there is no endpoint, no signature and
  // no outbound POST. The submission path settles the row itself.
  if (approved.destination === "metaapi_direct" && approved.direct) {
    const result = await submitDirectOrder(
      db,
      { id: delivery.id, dry_run: approved.dryRun },
      {
        instrument: approved.plan.instrument,
        signalId: approved.plan.signalId,
        direction: approved.plan.direction,
        entryPrice: approved.plan.entryPrice,
        stopLoss: approved.plan.stopLoss,
        tp1: approved.plan.tp1,
        grade: approved.plan.grade,
        detectedAt: approved.plan.detectedAt,
      },
      approved.quantity,
      approved.direct,
      // The FINAL quantity is derived here, from the pre-submit broker snapshot,
      // so an equity change between revalidation and submission is reflected in
      // the submitted volume instead of being silently ignored.
      async (snapshot) => {
        const { resizeFromBrokerSnapshot } = await import("@/lib/execution/resize.server");
        return await resizeFromBrokerSnapshot(
          db,
          {
            userId: delivery.user_id,
            accountId: approved.direct!.accountId,
            instrument: approved.plan.instrument,
            entryPrice: approved.plan.entryPrice,
            stopLoss: approved.plan.stopLoss,
            signalId: approved.plan.signalId,
            riskPercent: approved.riskPercentOverride ?? null,
          },
          snapshot,
          Date.now(),
        );
      },
    );
    return {
      deliveryId: delivery.id,
      state: result.state,
      reason: result.reason,
      dryRun: approved.dryRun,
    };
  }

  const { order, endpoint, dryRun } = approved as typeof approved & {
    endpoint: NonNullable<typeof approved.endpoint>;
  };

  const isPine = endpoint.format === "pineconnector";
  const body = isPine
    ? pineBody(order, endpoint.secret)
    : JSON.stringify(jsonBody(order, endpoint.secret, dryRun));
  const headers = await signBody(endpoint.secret, body);
  const fingerprint = await requestFingerprint(body, headers["X-PTrades-Nonce"]);

  if (dryRun) {
    // Dry-run proves the whole control plane — switches, eligibility, quote
    // freshness, guardrails, quantity, SSRF validation, signing — without a
    // broker order. It runs even while live execution is globally disabled.
    const why = approved.dryRunReason ?? "dry-run";
    await settle(db, delivery.id, {
      state: "acknowledged",
      reason: `dry_run: validated and signed, not sent (${why})`,
      dry_run: true,
      execution_policy: order.policy,
      payload_version: PAYLOAD_VERSION,
      endpoint_host: endpoint.host,
      request_fingerprint: fingerprint,
      sent_at: null,
      settled_at: new Date().toISOString(),
    });
    return { deliveryId: delivery.id, state: "acknowledged", reason: "dry_run", dryRun: true };
  }

  // Mark `sent` BEFORE the POST: if this process dies mid-flight the row can
  // never be re-claimed, which is the whole point.
  await settle(db, delivery.id, {
    state: "sent",
    endpoint_host: endpoint.host,
    request_fingerprint: fingerprint,
    execution_policy: order.policy,
    payload_version: PAYLOAD_VERSION,
    sent_at: new Date().toISOString(),
  });

  /**
   * Final lifecycle read at the bridge boundary (Phase A2A, R3-FIX).
   *
   * `sent` is recorded before the irreversible network call so a worker death
   * cannot re-claim and double-fire the order. The stage is then re-read one last
   * time; a suspension in this tiny window rejects without POSTing.
   */
  const postSentGate = await assertCapability(
    db as unknown as SupabaseClient,
    submittedInstrument,
    "execute",
  );
  if (!postSentGate.allowed) {
    const reason = `${INSTRUMENT_NOT_APPROVED}: ${
      postSentGate.reason ?? `${submittedInstrument} is not approved for execution`
    }`;
    await settle(db, delivery.id, {
      state: "rejected",
      reason,
      settled_at: new Date().toISOString(),
    });
    return { deliveryId: delivery.id, state: "rejected", reason, dryRun: false };
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": isPine ? "text/plain" : "application/json",
        "x-ptrades-idempotency-key": `${order.signalId}-${delivery.user_id}-${delivery.bridge_profile}`,
        ...headers,
      },
      body,
      // No redirects: a 302 into private address space must not be followed.
      redirect: "manual",
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    const latency = Date.now() - startedAt;
    const text = await res.text().catch(() => "");

    if (!res.ok) {
      const reason = `bridge responded ${res.status}`;
      await settle(db, delivery.id, {
        state: "rejected",
        reason,
        http_status: res.status,
        latency_ms: latency,
        settled_at: new Date().toISOString(),
      });
      return { deliveryId: delivery.id, state: "rejected", reason, dryRun: false };
    }

    const orderId = readOrderId(text);
    if (!orderId) {
      const reason = "delivered to your bridge; broker acceptance unconfirmed";
      await settle(db, delivery.id, {
        state: "unknown",
        reason,
        http_status: res.status,
        latency_ms: latency,
        settled_at: new Date().toISOString(),
      });
      return { deliveryId: delivery.id, state: "unknown", reason, dryRun: false };
    }

    await settle(db, delivery.id, {
      state: "acknowledged",
      reason: null,
      http_status: res.status,
      latency_ms: latency,
      broker_order_id: orderId,
      settled_at: new Date().toISOString(),
    });
    return { deliveryId: delivery.id, state: "acknowledged", reason: null, dryRun: false };
  } catch (err) {
    // A transport error after `sent` is genuinely ambiguous — fail closed.
    const detail = err instanceof Error ? err.message : String(err);
    await settle(db, delivery.id, {
      state: "unknown",
      reason: `transport error after send: ${detail}`,
      latency_ms: Date.now() - startedAt,
      settled_at: new Date().toISOString(),
    });
    return { deliveryId: delivery.id, state: "unknown", reason: detail, dryRun: false };
  }
}

export function describeRejection(reason: string | null): string {
  if (!reason) return "";
  const key = reason.split(":")[0]?.trim() ?? "";
  return REJECT_COPY[key as keyof typeof REJECT_COPY] ?? reason;
}
